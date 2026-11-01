"use client";

import { ChevronDown, LayoutGrid } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { createTransactionAction, deleteTransactionAction } from "@/app/(app)/lancamentos/actions";
import { CategoryIcon } from "@/components/categories/category-icon";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type KeypadKey, KEYPAD_DIGITS, pressKey } from "@/domain/amount-keypad";
import { addDays, type CalendarDate, formatCalendarDate, isCalendarDate } from "@/domain/dates";
import { cycleOn, invoiceFor, shiftInvoice } from "@/domain/invoice-cycle";
import { formatBRL } from "@/domain/money";
import type { PaymentChoice } from "@/domain/register";
import {
  COUNTERPARTY_NAME_MAX,
  DESCRIPTION_MAX,
  type EntryType,
  INVOICE_OVERRIDE_WINDOW,
  PAYMENT_METHOD_LABELS,
  TRANSACTION_DATE_MIN,
} from "@/domain/transactions";
import { cn } from "@/lib/utils";

import { CategorySheet } from "./category-sheet";
import { Keypad } from "./keypad";
import { PaymentSheet } from "./payment-sheet";
import type { RegisterCard, RegisterProps } from "./types";

const TYPE_LABELS: Record<EntryType, string> = { EXPENSE: "Despesa", INCOME: "Receita" };

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

/** Enter on these keeps its own meaning (click, follow): it never saves. */
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

/** The single register screen: amount on the keypad, a category, save. The rest comes filled. */
export function RegisterForm({ accounts, cards, today, ...byType }: RegisterProps) {
  const router = useRouter();
  const [type, setType] = useState<EntryType>("EXPENSE");
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
  const seeded = JSON.stringify([byType.EXPENSE.payment, byType.INCOME.payment]);
  const [seed, setSeed] = useState(seeded);
  if (seed !== seeded) {
    setSeed(seeded);
    setPayments({ EXPENSE: byType.EXPENSE.payment!, INCOME: byType.INCOME.payment! });
  }
  const [date, setDate] = useState<CalendarDate>(today);
  // A new day while the screen was kept: "Hoje" moves along.
  const [knownToday, setKnownToday] = useState(today);
  if (knownToday !== today) {
    setKnownToday(today);
    if (date === knownToday) setDate(today);
  }
  const [chosenInvoice, setChosenInvoice] = useState<CalendarDate | null>(null);
  const [description, setDescription] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [sheet, setSheet] = useState<"categories" | "payment" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // One id per screen: a double tap or a retry after an error doesn't duplicate (task 8).
  const clientId = useRef<string | null>(null);
  const saved = useRef(false);
  const resetRef = useRef<() => void>(() => {});
  const ids = { counterparty: useId(), date: useId(), invoice: useId(), description: useId() };

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

  // The chosen category stays visible: it takes the last button when it isn't a top one.
  const selected = data.tree.flatMap((p) => [p, ...p.children]).find((c) => c.id === categoryId);
  const buttons =
    selected && !data.top.some((c) => c.id === selected.id)
      ? [...data.top.slice(0, -1), selected]
      : data.top;

  const place =
    payment.method === "CREDIT"
      ? card?.name
      : accounts.find((a) => a.id === payment.accountId)?.name;

  function press(key: KeypadKey) {
    setError(null);
    setCents((c) => pressKey(c, key));
  }

  // On a computer, the physical keyboard types the amount too (outside text fields).
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
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
      } else if (event.key === "Enter" && !isInteractive(event.target)) {
        saveRef.current();
      } else {
        return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sheet]);

  function switchType(next: EntryType) {
    if (next === type) return;
    setType(next);
    setCategoryId(null);
    setError(null);
  }

  function changeDate(next: string) {
    if (!next) return;
    setDate(next);
    setChosenInvoice(null);
  }

  function changePayment(next: PaymentChoice) {
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
    setType("EXPENSE");
    setCents(0);
    setCounterparty("");
    setCategoryId(null);
    setDate(today);
    setChosenInvoice(null);
    setDescription("");
    setShowDetails(false);
    setError(null);
  }

  function save() {
    if (cents === 0 || pending) return;
    setError(null);
    clientId.current ??= crypto.randomUUID();
    const amount = cents;
    const label = TYPE_LABELS[type];
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof createTransactionAction>>;
      try {
        result = await createTransactionAction(clientId.current, {
          type,
          amountCents: amount,
          date,
          method: payment.method,
          accountId: payment.accountId,
          cardId: payment.cardId,
          invoiceDueDate: chosenInvoice,
          categoryId,
          counterparty,
          description,
        });
      } catch {
        // Offline or a server error: keep everything (and the clientId, so a retry can't
        // duplicate if the first request did arrive).
        setError("Não foi possível salvar. Verifique a conexão e tente de novo.");
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const id = result.id;
      saved.current = true;
      toast(`${label} de ${formatBRL(amount)} salva`, {
        duration: 5_000,
        action: {
          label: "Desfazer",
          onClick: async () => {
            const undone = await deleteTransactionAction(id);
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
      <div role="group" aria-label="Tipo" className="grid grid-cols-2 rounded-lg bg-muted p-1">
        {(["EXPENSE", "INCOME"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={type === t}
            onClick={() => switchType(t)}
            className="h-10 rounded-md text-sm font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      <output
        aria-label="Valor"
        aria-live="polite"
        className={cn(
          "block text-center text-4xl font-semibold tracking-tight tabular-nums",
          cents === 0 && "text-muted-foreground",
          type === "INCOME" && cents > 0 && "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {formatBRL(cents)}
      </output>

      <div>
        <Label htmlFor={ids.counterparty} className="sr-only">
          O que foi?
        </Label>
        <Input
          id={ids.counterparty}
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          maxLength={COUNTERPARTY_NAME_MAX}
          autoComplete="off"
          enterKeyHint="done"
          onKeyDown={closeKeyboardOnEnter}
          placeholder={
            type === "EXPENSE" ? "O que foi? Padaria, mercado…" : "O que foi? Salário, freela…"
          }
        />
      </div>

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

      <div className="grid grid-cols-1 gap-2">
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

        {invoice && (
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
          {showDetails ? "Menos detalhes" : "Mais detalhes"}
        </button>
        {showDetails && (
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
        )}
      </div>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] -mx-4 grid gap-2 border-t bg-background px-4 py-2 md:bottom-0">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Keypad onKey={press} />
        <Button type="submit" className="h-11 text-base" disabled={cents === 0 || pending}>
          {pending ? "Salvando…" : `Salvar ${TYPE_LABELS[type].toLowerCase()}`}
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
