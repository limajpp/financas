"use client";

import { ChevronDown, LayoutGrid } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";

import { undoSubscriptionAction } from "@/app/(app)/assinaturas/actions";
import {
  createTransactionAction,
  createTransferAction,
  deleteTransactionAction,
} from "@/app/(app)/lancamentos/actions";
import { CategoryIcon } from "@/components/categories/category-icon";
import { NativeSelect } from "@/components/native-select";
import { useOutbox } from "@/components/outbox/outbox-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { type KeypadKey, KEYPAD_DIGITS, pressKey } from "@/domain/amount-keypad";
import { ALIAS_MAX } from "@/domain/counterparty-memory";
import { formatDocument } from "@/domain/document";
import { normalizeName } from "@/domain/names";
import {
  addDays,
  type CalendarDate,
  formatCalendarDate,
  isCalendarDate,
  todayInSaoPaulo,
} from "@/domain/dates";
import { INSTALLMENTS_MAX, INSTALLMENTS_MIN, splitAmount } from "@/domain/installments";
import { cycleOn, invoiceFor, shiftInvoice } from "@/domain/invoice-cycle";
import { formatBRL } from "@/domain/money";
import type { OutboxItem } from "@/domain/outbox";
import type { PaymentChoice, TransferChoice } from "@/domain/register";
import {
  COUNTERPARTY_NAME_MAX,
  DESCRIPTION_MAX,
  type EntryType,
  INVOICE_OVERRIDE_WINDOW,
  METHODS_BY_TYPE,
  PAYMENT_METHOD_LABELS,
  TRANSACTION_DATE_MIN,
  TRANSFER_METHODS,
} from "@/domain/transactions";
import { findInOutbox, putInOutbox, removeFromOutbox } from "@/lib/outbox-db";
import { discardFromOutbox } from "@/lib/outbox-sync";
import { cn } from "@/lib/utils";
import { entrySchema, transferSchema } from "@/lib/validation/transactions";

import { CategorySheet } from "./category-sheet";
import { CounterpartyCombobox } from "./counterparty-combobox";
import { applyPick, leavePick, type Prefill, type PrefillFields } from "./prefill";
import { Keypad } from "./keypad";
import { PaymentSheet } from "./payment-sheet";
import type { CounterpartyOption, RegisterCard, RegisterProps } from "./types";

/** What the screen registers: an expense or income, or a transfer between accounts (task 11). */
type Kind = EntryType | "TRANSFER";

const KIND_LABELS: Record<Kind, string> = {
  EXPENSE: "Despesa",
  INCOME: "Receita",
  TRANSFER: "Transferência",
};

/** The invoices a credit purchase on `date` can go to: the computed one ± the override window. */
function invoiceOptions(card: RegisterCard, date: CalendarDate) {
  const cycle = cycleOn(card.cycles, date);
  const computed = invoiceFor(cycle, date);
  const options = [];
  for (let n = -INVOICE_OVERRIDE_WINDOW; n <= INVOICE_OVERRIDE_WINDOW; n++) {
    options.push(shiftInvoice(cycle, computed, n).dueDate);
  }
  return { computed: computed.dueDate, options };
}

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function isInteractive(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest("button, a, [role=button], summary, [tabindex]") !== null
  );
}

/** Return on a text field closes the keyboard; it doesn't submit the form. */
function closeKeyboardOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.currentTarget.blur();
}

/** A save that doesn't answer in this long goes to the offline queue (a connection in name only). */
const SAVE_TIMEOUT_MS = 8_000;
const TIMED_OUT = Symbol("timed out");

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The single register screen: amount on the keypad, a category, save. The rest comes filled. */
export function RegisterForm({
  accounts,
  cards,
  counterparties,
  today: serverToday,
  transfer: transferDefault,
  ...byType
}: RegisterProps) {
  const router = useRouter();
  const outbox = useOutbox();
  // Opened offline, this screen is a saved copy from another day: "Hoje" follows the device's
  // clock when it is ahead of the day the server rendered.
  const deviceToday = useSyncExternalStore(
    subscribeToVisibility,
    () => todayInSaoPaulo(),
    () => serverToday,
  );
  const today = deviceToday > serverToday ? deviceToday : serverToday;
  // "Corrigir" on an entry the server refused (task 16): the queue item being fixed.
  const fixId = useSearchParams().get("corrigir");
  const [fixing, setFixing] = useState<OutboxItem | null>(null);
  const [kind, setKind] = useState<Kind>("EXPENSE");
  // The entry type behind the expense/income parts (hidden while on a transfer).
  const type: EntryType = kind === "TRANSFER" ? "EXPENSE" : kind;
  const [cents, setCents] = useState(0);
  const [counterparty, setCounterparty] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  // Each type remembers its own payment (an income never starts on credit).
  const [payments, setPayments] = useState<Record<EntryType, PaymentChoice>>({
    EXPENSE: byType.EXPENSE.payment!,
    INCOME: byType.INCOME.payment!,
  });
  // Next keeps this route alive between visits (<Activity>), and the props are fetched again.
  // When the server's remembered payment changes (another device, "Desfazer"), follow it.
  const [transferState, setTransfer] = useState<TransferChoice | null>(transferDefault);
  const seeded = JSON.stringify([byType.EXPENSE.payment, byType.INCOME.payment, transferDefault]);
  const [seed, setSeed] = useState(seeded);
  if (seed !== seeded) {
    setSeed(seeded);
    setPayments({ EXPENSE: byType.EXPENSE.payment!, INCOME: byType.INCOME.payment! });
    setTransfer(transferDefault);
  }
  const [date, setDate] = useState<CalendarDate>(today);
  // A new day while the screen was kept: "Hoje" moves along.
  const [knownToday, setKnownToday] = useState(today);
  if (knownToday !== today) {
    setKnownToday(today);
    if (date === knownToday) setDate(today);
  }
  const [chosenInvoice, setChosenInvoice] = useState<CalendarDate | null>(null);
  // "Parcelado": the number of installments, or null (task 12).
  const [installmentCount, setInstallmentCount] = useState<number | null>(null);
  // "Assinatura": the expense repeats every month on its day (task 13).
  const [subscriptionOn, setSubscription] = useState(false);
  const [description, setDescription] = useState("");
  const [alias, setAlias] = useState("");
  const [documentText, setDocumentText] = useState("");
  // What the last memory suggestion filled (see ./prefill.ts).
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [sheet, setSheet] = useState<"categories" | "payment" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // One id per screen: a double tap or a retry after an error doesn't duplicate (task 8).
  const clientId = useRef<string | null>(null);
  const saved = useRef(false);
  const resetRef = useRef<() => void>(() => {});
  const ids = {
    installments: useId(),
    subscription: useId(),
    installmentCount: useId(),
    from: useId(),
    to: useId(),
    date: useId(),
    invoice: useId(),
    description: useId(),
    alias: useId(),
    document: useId(),
  };

  const data = byType[type];
  // The chosen account or card may have been archived since: back to the server's default.
  const stored = payments[type];
  const usable =
    accounts.some((a) => a.id === stored.accountId) &&
    (stored.method !== "CREDIT" || cards.some((c) => c.id === stored.cardId));
  const payment = usable ? stored : data.payment!;
  const card = payment.method === "CREDIT" ? cards.find((c) => c.id === payment.cardId) : undefined;
  // While a year is being typed the date input reports dates like 0002-03-11: no invoice then.
  const validDate = isCalendarDate(date) && date >= TRANSACTION_DATE_MIN && date <= today;
  const invoice = card && validDate ? invoiceOptions(card, date) : null;
  const yesterday = addDays(today, -1);
  // Only a credit purchase can be in installments; anything else turns it off.
  const canSplit = kind === "EXPENSE" && payment.method === "CREDIT";
  const installments = canSplit ? installmentCount : null;
  const subscription = kind === "EXPENSE" && subscriptionOn;
  const split =
    installments !== null && cents >= installments ? splitAmount(cents, installments) : null;

  // The chosen category stays visible: it takes the last button when it isn't a top one.
  const selected = data.tree.flatMap((p) => [p, ...p.children]).find((c) => c.id === categoryId);
  const buttons =
    selected && !data.top.some((c) => c.id === selected.id)
      ? [...data.top.slice(0, -1), selected]
      : data.top;

  // An account archived since falls back to the server's default transfer.
  const transfer =
    transferState &&
    accounts.some((a) => a.id === transferState.accountId) &&
    accounts.some((a) => a.id === transferState.toAccountId)
      ? transferState
      : transferDefault;
  const sameAccount = transfer !== null && transfer.accountId === transfer.toAccountId;
  const canSave =
    cents > 0 &&
    !pending &&
    (kind !== "TRANSFER" || (transfer !== null && !sameAccount)) &&
    (installments === null || split !== null);

  const place =
    payment.method === "CREDIT"
      ? card?.name
      : accounts.find((a) => a.id === payment.accountId)?.name;

  function press(key: KeypadKey) {
    setError(null);
    setCents((c) => pressKey(c, key));
  }

  // On a computer, the physical keyboard types the amount too (outside text fields).
  // Enter saves, except on a control reached with Tab, where it keeps its own meaning (click,
  // follow). A button focused by a click doesn't count: there the browser's Enter would click it
  // again. (:focus-visible can't tell: Chromium turns it on as soon as a key is pressed.)
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    let focusByKeyboard = false;
    function onPointerDown() {
      focusByKeyboard = false;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        focusByKeyboard = true;
        return;
      }
      if (event.defaultPrevented || isTyping(event.target) || sheet !== null) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key: KeypadKey | null = (KEYPAD_DIGITS as readonly string[]).includes(event.key)
        ? (event.key as KeypadKey)
        : event.key === "Backspace"
          ? "backspace"
          : null;
      if (key) {
        setError(null);
        setCents((c) => pressKey(c, key));
      } else if (event.key === "Enter" && !(focusByKeyboard && isInteractive(event.target))) {
        // Saving instead of the browser's Enter, which would click the focused button again.
        saveRef.current();
      } else {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [sheet]);

  const categoriesById = new Map(
    data.tree.flatMap((p) => [p, ...p.children]).map((c) => [c.id, c]),
  );

  /** A memory suggestion fills what's still empty: name, category, description, CPF/CNPJ. */
  function setFields(fields: PrefillFields) {
    setCategoryId(fields.categoryId);
    setDescription(fields.description);
    setDocumentText(fields.document);
  }

  function pickCounterparty(option: CounterpartyOption) {
    setCounterparty(option.name);
    const suggestion = option.suggestions[type];
    const picked = applyPick({ categoryId, description, document: documentText }, prefill, {
      name: option.name,
      categoryId:
        suggestion.categoryId && categoriesById.has(suggestion.categoryId)
          ? suggestion.categoryId
          : null,
      description: suggestion.description,
      document: option.document && formatDocument(option.document),
    });
    setFields(picked.fields);
    setPrefill(picked.prefill);
  }

  function changeCounterparty(text: string) {
    setCounterparty(text);
    // Typing something else leaves the pick: what it filled goes with it.
    if (prefill && normalizeName(text) !== normalizeName(prefill.name)) {
      setFields(leavePick({ categoryId, description, document: documentText }, prefill));
      setPrefill(null);
    }
  }

  function switchKind(next: Kind) {
    if (next === kind) return;
    setInstallmentCount(null);
    setSubscription(false);
    // Another kind of entry: a retry after a network error must not reuse the previous one's id
    // (the server would answer with the entry that may have arrived, of the other kind). An entry
    // being fixed never arrived: it keeps its id, so the fixed one replaces it in the queue.
    if (!fixing) clientId.current = null;
    setKind(next);
    setCategoryId(null);
    setError(null);
  }

  function changeDate(next: string) {
    if (!next) return;
    setDate(next);
    setChosenInvoice(null);
  }

  function changePayment(next: PaymentChoice) {
    // "Parcelado" is only for credit: leaving credit turns it off.
    if (next.method !== "CREDIT") setInstallmentCount(null);
    if (next.cardId !== payment.cardId || next.method !== payment.method) setChosenInvoice(null);
    setPayments((current) => ({ ...current, [type]: next }));
  }

  /**
   * Back to a blank entry. Next keeps this route alive (hidden) after navigating away
   * (cacheComponents uses <Activity>), so without this the next visit would show the old amount
   * and reuse the clientId, which the server would take as a retry of the saved entry.
   * The payments stay: they are the last used ones.
   */
  function reset() {
    clientId.current = null;
    setKind("EXPENSE");
    setCents(0);
    setCounterparty("");
    setCategoryId(null);
    setDate(today);
    setChosenInvoice(null);
    setInstallmentCount(null);
    setSubscription(false);
    setDescription("");
    setAlias("");
    setDocumentText("");
    setPrefill(null);
    setShowDetails(false);
    setError(null);
    setFixing(null);
  }

  /**
   * Loads a refused entry from the offline queue back into the form. An account, card or category
   * that no longer exists is left out: the form keeps its default there.
   */
  function fill(item: OutboxItem) {
    const data = (item.data ?? {}) as Record<string, unknown>;
    reset();
    clientId.current = item.clientId;
    setFixing(item);
    setCents(typeof data.amountCents === "number" ? data.amountCents : 0);
    if (typeof data.date === "string" && isCalendarDate(data.date)) setDate(data.date);
    setDescription(text(data.description));
    if (item.kind === "TRANSFER") {
      setKind("TRANSFER");
      const method = TRANSFER_METHODS.find((m) => m === data.method);
      if (method && typeof data.accountId === "string" && typeof data.toAccountId === "string") {
        setTransfer({ method, accountId: data.accountId, toAccountId: data.toAccountId });
      }
    } else {
      const entryType: EntryType = data.type === "INCOME" ? "INCOME" : "EXPENSE";
      setKind(entryType);
      setCounterparty(text(data.counterparty));
      const categories = byType[entryType].tree.flatMap((p) => [p, ...p.children]);
      setCategoryId(categories.find((c) => c.id === data.categoryId)?.id ?? null);
      const method = METHODS_BY_TYPE[entryType].find((m) => m === data.method);
      if (method && typeof data.accountId === "string") {
        const choice: PaymentChoice = {
          method,
          accountId: data.accountId,
          cardId: typeof data.cardId === "string" ? data.cardId : null,
        };
        setPayments((current) => ({ ...current, [entryType]: choice }));
      }
      if (typeof data.invoiceDueDate === "string") setChosenInvoice(data.invoiceDueDate);
      if (typeof data.installments === "number") setInstallmentCount(data.installments);
      setSubscription(data.subscription === true);
      setAlias(text(data.counterpartyAlias));
      setDocumentText(text(data.counterpartyDocument));
      setShowDetails(
        [data.description, data.counterpartyAlias, data.counterpartyDocument].some(
          (value) => text(value) !== "",
        ),
      );
    }
    setError(item.error ?? null);
  }
  const fillRef = useRef(fill);
  useEffect(() => {
    fillRef.current = fill;
  });
  useEffect(() => {
    if (!fixId) return;
    let stale = false;
    void outbox
      .whenUser()
      .then((userId) => findInOutbox(userId, fixId))
      .then((item) => {
        if (stale) return;
        if (item) fillRef.current(item);
        // Already sent or discarded (another tab): a plain, blank register screen.
        else router.replace("/registrar");
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [fixId, outbox, router]);

  function save() {
    // Already saved: the screen is on its way home (the form resets once it's hidden).
    if (!canSave || saved.current) return;
    setError(null);
    const id = (clientId.current ??= crypto.randomUUID());
    const amount = cents;
    const label = KIND_LABELS[kind];
    const isTransfer = kind === "TRANSFER";
    const input = isTransfer
      ? {
          amountCents: amount,
          date,
          method: transfer!.method,
          accountId: transfer!.accountId,
          toAccountId: transfer!.toAccountId,
          description,
        }
      : {
          type,
          amountCents: amount,
          date,
          method: payment.method,
          accountId: payment.accountId,
          cardId: payment.cardId,
          invoiceDueDate: chosenInvoice,
          categoryId,
          counterparty,
          counterpartyAlias: alias,
          counterpartyDocument: documentText,
          description,
          installments,
          subscription,
        };
    const wasFixing = fixing !== null;

    /**
     * Keeps the entry on the device, to be sent when the connection is back (task 16). False when
     * it couldn't be kept (a mistake in the form, or no storage): the message is on the screen.
     * `attempted`: a request was already made and may still arrive, so there is no "Desfazer"
     * (taking the entry out of the queue wouldn't stop it from being created).
     */
    async function queue(attempted: boolean) {
      const checked = (isTransfer ? transferSchema : entrySchema).safeParse(input);
      if (!checked.success) {
        setError(checked.error.issues[0]?.message ?? "Dados inválidos.");
        return false;
      }
      const userId = outbox.userId();
      if (!userId) return false;
      try {
        await putInOutbox({
          clientId: id,
          userId,
          kind: isTransfer ? "TRANSFER" : "ENTRY",
          data: input,
          createdAt: fixing?.createdAt ?? Date.now(),
          status: "PENDING",
        });
      } catch {
        return false;
      }
      toast(`${label} de ${formatBRL(amount)} salva no aparelho`, {
        description: attempted
          ? "O envio não respondeu. Ela será enviada de novo em instantes."
          : "Ela será enviada quando a conexão voltar.",
        duration: 5_000,
        action: attempted
          ? undefined
          : {
              label: "Desfazer",
              onClick: () =>
                void discardFromOutbox(id).then(
                  (removed) =>
                    removed
                      ? toast("Lançamento desfeito.")
                      : toast.error(
                          "Este lançamento já foi enviado. Para apagar, exclua em Lançamentos.",
                        ),
                  () => toast.error("Não foi possível desfazer."),
                ),
            },
      });
      // No trip home: without a connection the next screen might not load. The form goes blank
      // for the next entry.
      reset();
      if (wasFixing) router.replace("/registrar");
      return true;
    }

    startTransition(async () => {
      const failed = "Não foi possível salvar. Verifique a conexão e tente de novo.";
      if (!navigator.onLine) {
        if (!(await queue(false))) setError((current) => current ?? failed);
        return;
      }
      let result: Awaited<ReturnType<typeof createTransactionAction>> | typeof TIMED_OUT;
      try {
        result = await withTimeout(
          isTransfer ? createTransferAction(id, input) : createTransactionAction(id, input),
          SAVE_TIMEOUT_MS,
        );
      } catch {
        result = TIMED_OUT;
      }
      if (result === TIMED_OUT) {
        // No answer, or an error on the way: the entry waits on the device. If the request did
        // arrive, the queue's resend gets the same entry back (same clientId).
        // Otherwise everything stays filled in, with the clientId, for a retry.
        if (!(await queue(true))) setError((current) => current ?? failed);
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // A fixed entry is saved now: it leaves the queue.
      if (wasFixing) void removeFromOutbox(id).catch(() => {});
      const savedId = result.id;
      const count = isTransfer ? null : installments;
      const isSubscription = subscription;
      saved.current = true;
      const message = isSubscription
        ? `Assinatura de ${formatBRL(amount)} salva`
        : `${label} de ${formatBRL(amount)}${count ? ` em ${count}×` : ""} salva`;
      toast(message, {
        duration: 5_000,
        action: {
          label: "Desfazer",
          onClick: async () => {
            // A purchase in installments goes whole (from the 1st on); a new subscription goes
            // with its rule.
            let undone: Awaited<ReturnType<typeof deleteTransactionAction>>;
            try {
              undone = isSubscription
                ? await undoSubscriptionAction(savedId)
                : await deleteTransactionAction(savedId, count ? "following" : "this");
            } catch {
              toast.error("Não foi possível desfazer. Verifique a conexão.");
              return;
            }
            if (undone.ok) toast("Lançamento desfeito.");
            else toast.error(undone.error);
          },
        },
      });
      router.push("/");
    });
  }
  useEffect(() => {
    saveRef.current = save;
    resetRef.current = reset;
  });

  // After a save, the form goes blank once this route is hidden or left (effects are cleaned up
  // then), so the screen doesn't flash empty before the home page shows.
  useEffect(
    () => () => {
      if (saved.current) {
        saved.current = false;
        resetRef.current();
      }
    },
    [],
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="flex flex-col gap-3"
      noValidate
    >
      <div role="group" aria-label="Tipo" className="grid grid-cols-3 rounded-lg bg-muted p-1">
        {(["EXPENSE", "INCOME", "TRANSFER"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => switchKind(k)}
            className="h-10 min-w-0 truncate rounded-md px-1 text-sm font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <output
        aria-label="Valor"
        aria-live="polite"
        className={cn(
          "block text-center text-4xl font-semibold tracking-tight tabular-nums",
          cents === 0 && "text-muted-foreground",
          kind === "INCOME" && cents > 0 && "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {formatBRL(cents)}
      </output>
      {installments !== null && cents > 0 && (
        <p aria-live="polite" className="-mt-2 text-center text-sm text-muted-foreground">
          {split
            ? `${installments}× de ${formatBRL(split[1]!)}${
                split[0] !== split[1] ? ` (1ª de ${formatBRL(split[0]!)})` : ""
              }`
            : `Valor pequeno demais para ${installments}×.`}
        </p>
      )}

      {kind === "TRANSFER" ? (
        <TransferFields
          transfer={transfer}
          accounts={accounts}
          sameAccount={sameAccount}
          ids={ids}
          onChange={setTransfer}
        />
      ) : (
        <>
          <CounterpartyCombobox
            value={counterparty}
            onChange={changeCounterparty}
            onPick={pickCounterparty}
            options={counterparties}
            type={type}
            categories={categoriesById}
            maxLength={COUNTERPARTY_NAME_MAX}
            placeholder={
              type === "EXPENSE" ? "O que foi? Padaria, mercado…" : "O que foi? Salário, freela…"
            }
          />

          <div role="group" aria-label="Categoria" className="grid grid-cols-3 gap-2">
            {buttons.map((category) => (
              <button
                key={category.id}
                type="button"
                aria-pressed={category.id === categoryId}
                onClick={() => setCategoryId((id) => (id === category.id ? null : category.id))}
                className="flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 text-xs aria-pressed:border-primary aria-pressed:bg-primary/5 aria-pressed:font-medium"
              >
                <CategoryIcon icon={category.icon} color={category.color} className="size-6" />
                <span className="w-full truncate text-center">{category.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSheet("categories")}
              className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed px-1 text-xs"
            >
              <LayoutGrid aria-hidden className="size-5 text-muted-foreground" />
              Mais
            </button>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 gap-2">
        {kind !== "TRANSFER" && (
          <button
            type="button"
            onClick={() => setSheet("payment")}
            aria-label={`Forma de pagamento: ${place} · ${PAYMENT_METHOD_LABELS[payment.method]}`}
            className="flex h-11 items-center justify-between gap-2 rounded-lg border px-3 text-left"
          >
            <span className="truncate">
              {place} · {PAYMENT_METHOD_LABELS[payment.method]}
            </span>
            <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </button>
        )}

        {canSplit && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id={ids.installments}
                checked={installments !== null}
                onCheckedChange={(on) => {
                  setInstallmentCount(on ? (installmentCount ?? 2) : null);
                  // A purchase in installments isn't a subscription.
                  if (on) setSubscription(false);
                }}
              />
              <Label htmlFor={ids.installments}>Parcelado</Label>
            </div>
            {installments !== null && (
              <NativeSelect
                id={ids.installmentCount}
                aria-label="Número de parcelas"
                value={installments}
                onChange={(e) => setInstallmentCount(Number(e.target.value))}
                className="w-24"
              >
                {Array.from(
                  { length: INSTALLMENTS_MAX - INSTALLMENTS_MIN + 1 },
                  (_, i) => i + INSTALLMENTS_MIN,
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}×
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
        )}

        {kind === "EXPENSE" && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="flex items-center gap-2">
              <Switch
                id={ids.subscription}
                checked={subscription}
                onCheckedChange={(on) => {
                  setSubscription(on);
                  if (on) setInstallmentCount(null);
                }}
              />
              <Label htmlFor={ids.subscription}>Assinatura</Label>
            </div>
            {subscription && validDate && (
              <p className="text-sm text-muted-foreground">
                Repete todo dia {Number(date.slice(8, 10))}
                {Number(date.slice(8, 10)) > 28 && " (nos meses mais curtos, no último dia)"}
              </p>
            )}
          </div>
        )}

        {kind !== "TRANSFER" && invoice && installments !== null && (
          <p className="text-sm text-muted-foreground">
            1ª parcela na fatura que vence em {formatCalendarDate(invoice.computed)}
          </p>
        )}

        {kind !== "TRANSFER" && invoice && installments === null && (
          <div className="grid gap-1">
            <Label htmlFor={ids.invoice} className="font-normal text-muted-foreground">
              Cai na fatura que vence em
            </Label>
            <NativeSelect
              id={ids.invoice}
              value={chosenInvoice ?? invoice.computed}
              onChange={(e) =>
                setChosenInvoice(e.target.value === invoice.computed ? null : e.target.value)
              }
            >
              {invoice.options.map((due) => (
                <option key={due} value={due}>
                  {formatCalendarDate(due)}
                  {due === invoice.computed ? " (calculada)" : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}

        <div className="flex items-center gap-2">
          {[
            { label: "Hoje", value: today },
            { label: "Ontem", value: yesterday },
          ].map((option) => (
            <Button
              key={option.label}
              type="button"
              variant={date === option.value ? "default" : "outline"}
              className="h-10"
              aria-pressed={date === option.value}
              onClick={() => changeDate(option.value)}
            >
              {option.label}
            </Button>
          ))}
          <Input
            id={ids.date}
            type="date"
            aria-label="Data"
            value={date}
            min={TRANSACTION_DATE_MIN}
            max={today}
            onChange={(e) => changeDate(e.target.value)}
            className="h-10 min-w-0 flex-1"
          />
        </div>

        <button
          type="button"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((s) => !s)}
          className="justify-self-start text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {showDetails
            ? "Menos detalhes"
            : description || (kind !== "TRANSFER" && (documentText || alias))
              ? "Mais detalhes · preenchidos"
              : "Mais detalhes"}
        </button>
        {showDetails && (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={ids.description}>Observação</Label>
              <Input
                id={ids.description}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={DESCRIPTION_MAX}
                autoComplete="off"
                enterKeyHint="done"
                onKeyDown={closeKeyboardOnEnter}
              />
            </div>
            {kind !== "TRANSFER" && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor={ids.alias}>Nome no extrato</Label>
                  <Input
                    id={ids.alias}
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    maxLength={ALIAS_MAX}
                    autoComplete="off"
                    autoCapitalize="characters"
                    enterKeyHint="done"
                    onKeyDown={closeKeyboardOnEnter}
                    placeholder="Como aparece no banco: PAG*JOSE…"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={ids.document}>CPF/CNPJ</Label>
                  <Input
                    id={ids.document}
                    value={documentText}
                    onChange={(e) => setDocumentText(e.target.value)}
                    maxLength={24}
                    autoComplete="off"
                    autoCapitalize="characters"
                    enterKeyHint="done"
                    onKeyDown={closeKeyboardOnEnter}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] -mx-4 grid gap-2 border-t bg-background px-4 py-2 md:bottom-0">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Keypad onKey={press} />
        <Button type="submit" className="h-11 text-base" disabled={!canSave}>
          {pending ? "Salvando…" : `Salvar ${KIND_LABELS[kind].toLowerCase()}`}
        </Button>
      </div>

      <CategorySheet
        open={sheet === "categories"}
        onOpenChange={(open) => setSheet(open ? "categories" : null)}
        tree={data.tree}
        selectedId={categoryId}
        onSelect={(id) => {
          setCategoryId(id);
          setSheet(null);
        }}
      />
      <PaymentSheet
        open={sheet === "payment"}
        onOpenChange={(open) => setSheet(open ? "payment" : null)}
        type={type}
        value={payment}
        onChange={changePayment}
        accounts={accounts}
        cards={cards}
      />
    </form>
  );
}

const TRANSFER_METHOD_LABELS: Record<TransferChoice["method"], string> = {
  PIX: "Pix",
  TED: "TED",
  CASH: "Dinheiro",
};

/** Origin, destination and method of a transfer. Native selects: the iPhone opens its wheel. */
function TransferFields({
  transfer,
  accounts,
  sameAccount,
  ids,
  onChange,
}: {
  transfer: TransferChoice | null;
  accounts: { id: string; name: string }[];
  sameAccount: boolean;
  ids: { from: string; to: string };
  onChange: (transfer: TransferChoice) => void;
}) {
  if (!transfer) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
        Cadastre outra conta para transferir.
      </p>
    );
  }
  const side = (label: string, id: string, field: "accountId" | "toAccountId") => (
    <div className="grid grid-cols-[3rem_1fr] items-center gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={transfer[field]}
        onChange={(e) => onChange({ ...transfer, [field]: e.target.value })}
        aria-invalid={sameAccount || undefined}
        aria-describedby={sameAccount ? `${ids.to}-hint` : undefined}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
  return (
    <div className="grid gap-2">
      {side("De", ids.from, "accountId")}
      {side("Para", ids.to, "toAccountId")}
      {sameAccount && (
        <p id={`${ids.to}-hint`} className="text-sm text-destructive">
          Escolha contas diferentes.
        </p>
      )}
      <div role="group" aria-label="Forma da transferência" className="grid grid-cols-3 gap-2">
        {TRANSFER_METHODS.map((method) => (
          <Button
            key={method}
            type="button"
            variant={transfer.method === method ? "default" : "outline"}
            aria-pressed={transfer.method === method}
            className="h-10"
            onClick={() => onChange({ ...transfer, method })}
          >
            {TRANSFER_METHOD_LABELS[method]}
          </Button>
        ))}
      </div>
    </div>
  );
}
