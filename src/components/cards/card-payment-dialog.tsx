"use client";

import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { createCardPaymentAction, deleteTransactionAction } from "@/app/(app)/lancamentos/actions";
import { MoneyInput } from "@/components/money-input";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import type { InvoiceSummary } from "@/domain/invoices";
import { formatBRL, formatBRLInput, parseBRL } from "@/domain/money";
import {
  CARD_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  TRANSACTION_DATE_MIN,
} from "@/domain/transactions";

import type { CardView, PayerOption } from "./types";

type Method = (typeof CARD_PAYMENT_METHODS)[number];

/** "10/12 (aberta) · R$ 300,00 a pagar": short enough for the select on a phone. */
function invoiceLabel(invoice: InvoiceSummary) {
  const due = formatCalendarDate(invoice.dueDate).slice(0, 5);
  const left =
    invoice.remainingCents < 0
      ? `${formatBRL(-invoice.remainingCents)} a favor`
      : `${formatBRL(invoice.remainingCents)} a pagar`;
  return `${due}${invoice.open ? " (aberta)" : ""} · ${left}`;
}

/** The amount field starts with what's left on the invoice (empty when nothing is). */
const amountFor = (invoice: InvoiceSummary | undefined) =>
  invoice && invoice.remainingCents > 0 ? formatBRLInput(invoice.remainingCents) : "";

/** "Pagar fatura": which invoice, how much, from which account. */
export function CardPaymentDialog({
  card,
  accounts,
  onClose,
}: {
  card: CardView | null;
  accounts: PayerOption[];
  onClose: () => void;
}) {
  // Keeps the last form on screen while the sheet animates out.
  const [shown, setShown] = useState(card);
  if (card && card !== shown) setShown(card);

  return (
    <Dialog open={card !== null} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        {shown && <PaymentForm key={shown.id} card={shown} accounts={accounts} onDone={onClose} />}
      </ResponsiveDialogContent>
    </Dialog>
  );
}

function PaymentForm({
  card,
  accounts,
  onDone,
}: {
  card: CardView;
  accounts: PayerOption[];
  onDone: () => void;
}) {
  const { invoices, defaultDueDate } = card.payment;
  const today = todayInSaoPaulo();
  const payers = accounts.filter((a) => !a.archived);
  const [dueDate, setDueDate] = useState(defaultDueDate ?? "");
  const [amount, setAmount] = useState(amountFor(invoices.find((i) => i.dueDate === dueDate)));
  const [amountTouched, setAmountTouched] = useState(false);
  const [accountId, setAccountId] = useState(
    payers.some((a) => a.id === card.payment.accountId) ? card.payment.accountId : payers[0]?.id,
  );
  const [method, setMethod] = useState<Method>(
    (CARD_PAYMENT_METHODS as readonly string[]).includes(card.payment.method)
      ? (card.payment.method as Method)
      : "PIX",
  );
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const clientId = useRef<string | null>(null);
  const ids = { invoice: useId(), amount: useId(), account: useId(), date: useId() };

  // Invoices with something to pay, the open one, and the chosen one.
  const options = invoices.filter((i) => i.remainingCents > 0 || i.open || i.dueDate === dueDate);

  function chooseInvoice(next: string) {
    setDueDate(next);
    if (!amountTouched) setAmount(amountFor(invoices.find((i) => i.dueDate === next)));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = parseBRL(amount);
    if (cents === null || cents <= 0) {
      setError("Informe o valor pago.");
      return;
    }
    if (!accountId) {
      setError("Cadastre uma conta ativa para pagar a fatura.");
      return;
    }
    setError(null);
    clientId.current ??= crypto.randomUUID();
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof createCardPaymentAction>>;
      try {
        result = await createCardPaymentAction(clientId.current, {
          amountCents: cents,
          date,
          method,
          accountId,
          cardId: card.id,
          invoiceDueDate: dueDate,
        });
      } catch {
        setError("Não foi possível salvar. Verifique a conexão e tente de novo.");
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const id = result.id;
      toast(`Pagamento de ${formatBRL(cents)} salvo`, {
        duration: 5_000,
        action: {
          label: "Desfazer",
          onClick: async () => {
            const undone = await deleteTransactionAction(id);
            if (undone.ok) toast("Pagamento desfeito.");
            else toast.error(undone.error);
          },
        },
      });
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>Pagar fatura · {card.name}</DialogTitle>
        <DialogDescription className="sr-only">
          Escolha a fatura, o valor pago e a conta que paga.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor={ids.invoice}>Fatura (vencimento)</Label>
        <NativeSelect
          id={ids.invoice}
          value={dueDate}
          onChange={(e) => chooseInvoice(e.target.value)}
        >
          {options.map((invoice) => (
            <option key={invoice.dueDate} value={invoice.dueDate}>
              {invoiceLabel(invoice)}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={ids.amount}>
          Valor pago<span className="sr-only"> em reais</span>
        </Label>
        <MoneyInput
          id={ids.amount}
          value={amount}
          onValueChange={(value) => {
            setAmount(value);
            setAmountTouched(true);
          }}
          placeholder="0,00"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={ids.account}>Conta que paga</Label>
        <NativeSelect
          id={ids.account}
          value={accountId ?? ""}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {payers.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div role="group" aria-label="Forma de pagamento" className="grid grid-cols-4 gap-2">
        {CARD_PAYMENT_METHODS.map((m) => (
          <Button
            key={m}
            type="button"
            variant={method === m ? "default" : "outline"}
            aria-pressed={method === m}
            className="h-10 px-1"
            onClick={() => setMethod(m)}
          >
            {PAYMENT_METHOD_LABELS[m]}
          </Button>
        ))}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={ids.date}>Data do pagamento</Label>
        <Input
          id={ids.date}
          type="date"
          value={date}
          min={TRANSACTION_DATE_MIN}
          max={today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <ResponsiveDialogFooter>
        <Button type="submit" disabled={pending} className="h-10 w-full sm:w-auto">
          {pending ? "Salvando…" : "Salvar pagamento"}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}
