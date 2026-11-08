"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  deleteTransactionAction,
  updateCardPaymentAction,
  updateTransactionAction,
  updateTransferAction,
} from "@/app/(app)/lancamentos/actions";
import { MoneyInput } from "@/components/money-input";
import { NativeSelect } from "@/components/native-select";
import { CounterpartyCombobox } from "@/components/register/counterparty-combobox";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type CalendarDate, formatCalendarDate } from "@/domain/dates";
import { cycleOn, invoiceFor, shiftInvoice } from "@/domain/invoice-cycle";
import { PAYABLE_PAST_INVOICES } from "@/domain/invoices";
import { formatBRL, formatBRLInput, parseBRL } from "@/domain/money";
import {
  CARD_PAYMENT_METHODS,
  COUNTERPARTY_NAME_MAX,
  DESCRIPTION_MAX,
  INVOICE_OVERRIDE_WINDOW,
  type InstallmentScope,
  METHODS_BY_TYPE,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  TRANSACTION_DATE_MIN,
  TRANSFER_METHODS,
} from "@/domain/transactions";
import type { ActionResult } from "@/lib/action-result";

import type { ListItemView, ListOptions } from "./types";

const TITLES = {
  EXPENSE: "Editar despesa",
  INCOME: "Editar receita",
  TRANSFER: "Editar transferência",
  CARD_PAYMENT: "Editar pagamento de fatura",
} as const;

/** The edit form of one entry, as a sheet on the phone. */
export function TransactionEditDialog({
  item,
  options,
  today,
  onClose,
}: {
  item: ListItemView | null;
  options: ListOptions;
  today: CalendarDate;
  onClose: () => void;
}) {
  // Keeps the last form on screen while the sheet animates out.
  const [shown, setShown] = useState(item);
  if (item && item !== shown) setShown(item);

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        {shown && (
          <EditForm key={shown.id} item={shown} options={options} today={today} onDone={onClose} />
        )}
      </ResponsiveDialogContent>
    </Dialog>
  );
}

type Field = { label: string; children: React.ReactNode; hint?: string };

function FormField({ label, children, hint, id }: Field & { id: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EditForm({
  item,
  options,
  today,
  onDone,
}: {
  item: ListItemView;
  options: ListOptions;
  today: CalendarDate;
  onDone: () => void;
}) {
  const ids = {
    amount: useId(),
    category: useId(),
    method: useId(),
    place: useId(),
    to: useId(),
    date: useId(),
    invoice: useId(),
    description: useId(),
  };
  const installment = item.installmentGroupId !== null;
  const subscription = item.recurringRuleId !== null;
  const [type, setType] = useState(item.type);
  const [amount, setAmount] = useState(formatBRLInput(item.amountCents));
  const [counterparty, setCounterparty] = useState(item.counterparty?.name ?? "");
  const [categoryId, setCategoryId] = useState(item.category?.id ?? "");
  const [method, setMethod] = useState<PaymentMethod>(item.method);
  const [accountId, setAccountId] = useState(item.account?.id ?? "");
  const [toAccountId, setToAccountId] = useState(item.toAccount?.id ?? "");
  const [cardId, setCardId] = useState(item.card?.id ?? "");
  const [date, setDate] = useState(item.date);
  // A payment's invoice; for a credit purchase, only a manual choice (task 8): the computed one
  // follows the date and card.
  const [invoiceDueDate, setInvoiceDueDate] = useState(
    item.type === "CARD_PAYMENT" || item.invoiceOverridden ? (item.invoiceDueDate ?? "") : "",
  );
  const [description, setDescription] = useState(item.description ?? "");
  const [scope, setScope] = useState<InstallmentScope>("this");
  const [updateRule, setUpdateRule] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const entry = type === "EXPENSE" || type === "INCOME";
  const cents = parseBRL(amount);
  const amountChanged = cents !== null && cents !== item.amountCents;
  // An account or card the entry already had stays offered, even archived.
  const accounts = options.accounts.filter(
    (a) => !a.archived || a.id === item.account?.id || a.id === item.toAccount?.id,
  );
  const cards = options.cards.filter((c) => !c.archived || c.id === item.card?.id);
  const card = options.cards.find((c) => c.id === cardId);

  // The invoices a credit purchase can go to (task 8's window) or a payment can pay.
  const computedInvoice =
    card && method === "CREDIT" && type !== "CARD_PAYMENT" && date >= TRANSACTION_DATE_MIN
      ? invoiceFor(cycleOn(card.cycles, date), date).dueDate
      : null;
  const invoiceChoices = (() => {
    if (!card || date < TRANSACTION_DATE_MIN) return [];
    const dues: string[] = [];
    if (type === "CARD_PAYMENT") {
      // What the server accepts (task 11): the open invoice, the next one and the 12 before;
      // plus the one the payment already has.
      const cycle = cycleOn(card.cycles, today);
      const open = invoiceFor(cycle, today);
      for (let n = -PAYABLE_PAST_INVOICES; n <= 1; n++)
        dues.push(shiftInvoice(cycle, open, n).dueDate);
      if (item.invoiceDueDate) dues.push(item.invoiceDueDate);
    } else if (method === "CREDIT") {
      // A purchase's manual choice: the computed invoice ± the window (task 8).
      const cycle = cycleOn(card.cycles, date);
      const base = invoiceFor(cycle, date);
      for (let n = -INVOICE_OVERRIDE_WINDOW; n <= INVOICE_OVERRIDE_WINDOW; n++) {
        dues.push(shiftInvoice(cycle, base, n).dueDate);
      }
      if (invoiceDueDate) dues.push(invoiceDueDate);
    }
    return [...new Set(dues)].sort();
  })();

  async function run(action: () => Promise<ActionResult>, message: string) {
    setError(null);
    startTransition(async () => {
      let result: ActionResult;
      try {
        result = await action();
      } catch {
        setError("Não foi possível salvar. Verifique a conexão e tente de novo.");
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast(message);
      onDone();
    });
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cents === null || cents <= 0) {
      setError("Informe o valor. Use o formato 1.234,56.");
      return;
    }
    const base = { amountCents: cents, date, method, description };
    if (type === "TRANSFER") {
      return run(
        () => updateTransferAction(item.id, { ...base, accountId, toAccountId }),
        "Lançamento atualizado",
      );
    }
    if (type === "CARD_PAYMENT") {
      return run(
        () => updateCardPaymentAction(item.id, { ...base, accountId, cardId, invoiceDueDate }),
        "Lançamento atualizado",
      );
    }
    const credit = method === "CREDIT";
    return run(
      () =>
        updateTransactionAction(
          item.id,
          {
            ...base,
            type,
            accountId: credit ? null : accountId,
            cardId: credit ? cardId : null,
            // A manual invoice goes only when it isn't the computed one (task 8).
            invoiceDueDate:
              credit && !installment && invoiceDueDate && invoiceDueDate !== computedInvoice
                ? invoiceDueDate
                : null,
            categoryId: categoryId || null,
            counterparty,
          },
          scope,
          {
            updateRule:
              subscription &&
              amountChanged &&
              updateRule &&
              item.recurringRule?.status !== "CANCELED",
          },
        ),
      "Lançamento atualizado",
    );
  }

  function remove() {
    return run(() => deleteTransactionAction(item.id, scope), "Lançamento excluído");
  }

  const methods: readonly PaymentMethod[] =
    type === "TRANSFER"
      ? TRANSFER_METHODS
      : type === "CARD_PAYMENT"
        ? CARD_PAYMENT_METHODS
        : METHODS_BY_TYPE[type];
  const tree = entry ? options.categories[type] : [];

  return (
    <form onSubmit={save} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{TITLES[type]}</DialogTitle>
        <DialogDescription>
          {installment &&
            `Parcela ${item.installmentNumber} de ${item.installmentTotal}${
              item.installmentGroupCents !== null
                ? ` · ${formatBRL(item.installmentGroupCents)} no total`
                : ""
            }`}
          {subscription &&
            item.recurringRule &&
            `Assinatura · todo dia ${item.recurringRule.dayOfMonth}`}
          {!installment && !subscription && (
            <span className="sr-only">Corrija os campos e salve.</span>
          )}
        </DialogDescription>
      </DialogHeader>

      {entry && !installment && !subscription && (
        <div role="group" aria-label="Tipo" className="grid grid-cols-2 rounded-lg bg-muted p-1">
          {(["EXPENSE", "INCOME"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={type === t}
              onClick={() => {
                setType(t);
                setCategoryId("");
                if (!METHODS_BY_TYPE[t].includes(method)) setMethod("PIX");
              }}
              className="h-9 rounded-md text-sm font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
            >
              {t === "EXPENSE" ? "Despesa" : "Receita"}
            </button>
          ))}
        </div>
      )}

      <FormField id={ids.amount} label="Valor">
        <MoneyInput id={ids.amount} value={amount} onValueChange={setAmount} />
      </FormField>

      {subscription && amountChanged && item.recurringRule?.status !== "CANCELED" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={updateRule}
            onChange={(e) => setUpdateRule(e.target.checked)}
          />
          Atualizar também o valor da assinatura
        </label>
      )}

      {entry && (
        <>
          <CounterpartyCombobox
            value={counterparty}
            onChange={setCounterparty}
            onPick={(option) => setCounterparty(option.name)}
            options={options.counterparties}
            type={type}
            categories={new Map()}
            maxLength={COUNTERPARTY_NAME_MAX}
            placeholder="O que foi?"
          />
          <FormField id={ids.category} label="Categoria">
            <NativeSelect
              id={ids.category}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Sem categoria</option>
              {tree.map((parent) => (
                <optgroup key={parent.id} label={parent.name}>
                  <option value={parent.id}>{parent.name}</option>
                  {parent.children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.name}
                    </option>
                  ))}
                </optgroup>
              ))}
              {item.category &&
                !tree.some(
                  (p) =>
                    p.id === item.category!.id ||
                    p.children.some((c) => c.id === item.category!.id),
                ) &&
                type === item.type && (
                  <option value={item.category.id}>{item.category.name} (arquivada)</option>
                )}
            </NativeSelect>
          </FormField>
        </>
      )}

      <FormField id={ids.method} label="Forma">
        <NativeSelect
          id={ids.method}
          value={method}
          disabled={installment}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        >
          {methods.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      {(type === "CARD_PAYMENT" || (entry && method === "CREDIT")) && (
        <FormField id={ids.place} label="Cartão">
          <NativeSelect
            id={ids.place}
            value={cardId}
            disabled={installment || type === "CARD_PAYMENT"}
            onChange={(e) => {
              setCardId(e.target.value);
              setInvoiceDueDate("");
            }}
          >
            <option value="" disabled>
              Escolha
            </option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.archived ? `${c.name} (arquivado)` : c.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      )}

      {(type === "TRANSFER" || type === "CARD_PAYMENT" || method !== "CREDIT") && (
        <FormField
          id={type === "CARD_PAYMENT" ? ids.to : ids.place}
          label={type === "TRANSFER" ? "De" : type === "CARD_PAYMENT" ? "Conta que paga" : "Conta"}
        >
          <NativeSelect
            id={type === "CARD_PAYMENT" ? ids.to : ids.place}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="" disabled>
              Escolha
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.archived ? `${a.name} (arquivada)` : a.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      )}

      {type === "TRANSFER" && (
        <FormField id={ids.to} label="Para">
          <NativeSelect
            id={ids.to}
            value={toAccountId}
            onChange={(e) => setToAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.archived ? `${a.name} (arquivada)` : a.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      )}

      {invoiceChoices.length > 0 && !installment && (
        <FormField
          id={ids.invoice}
          label={type === "CARD_PAYMENT" ? "Fatura paga (vencimento)" : "Fatura (vencimento)"}
        >
          <NativeSelect
            id={ids.invoice}
            value={invoiceDueDate || computedInvoice || ""}
            onChange={(e) =>
              setInvoiceDueDate(e.target.value === computedInvoice ? "" : e.target.value)
            }
          >
            {invoiceChoices.map((due) => (
              <option key={due} value={due}>
                {formatCalendarDate(due)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      )}

      <FormField
        id={ids.date}
        label="Data"
        hint={
          installment
            ? "A data, o cartão e a forma de uma parcela não mudam. Para mudar, exclua e registre de novo."
            : undefined
        }
      >
        <Input
          id={ids.date}
          type="date"
          value={date}
          min={TRANSACTION_DATE_MIN}
          max={installment ? undefined : today}
          disabled={installment}
          onChange={(e) => {
            if (!e.target.value) return;
            setDate(e.target.value);
            // A new date recomputes a purchase's invoice (task 8); a payment keeps its invoice.
            if (type !== "CARD_PAYMENT") setInvoiceDueDate("");
          }}
        />
      </FormField>

      <FormField id={ids.description} label="Observação">
        <Input
          id={ids.description}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={DESCRIPTION_MAX}
          autoComplete="off"
        />
      </FormField>

      {installment && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Aplicar a</legend>
          {(
            [
              ["this", "Só esta parcela"],
              ["following", "Esta e as próximas"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope"
                value={value}
                checked={scope === value}
                onChange={() => setScope(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <ResponsiveDialogFooter className="gap-2">
        {confirming ? (
          <>
            <p className="self-center text-sm">
              {installment && scope === "following"
                ? "Excluir esta parcela e as próximas?"
                : "Excluir este lançamento?"}
            </p>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
              Excluir
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => setConfirming(true)}
            >
              Excluir
            </Button>
            <Button type="submit" disabled={pending} className="h-10">
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </>
        )}
      </ResponsiveDialogFooter>
    </form>
  );
}
