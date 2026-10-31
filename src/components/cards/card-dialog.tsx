"use client";

import { useId, useState, useTransition } from "react";

import { createCardAction, updateCardAction } from "@/app/(app)/contas/card-actions";
import { MoneyInput } from "@/components/money-input";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CARD_NAME_MAX } from "@/domain/cards";
import { formatCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { invoiceFor } from "@/domain/invoice-cycle";
import { formatBRLInput } from "@/domain/money";
import type { ActionResult } from "@/lib/action-result";

import type { CardView, PayerOption } from "./types";

export type CardDialogState = { mode: "create" } | { mode: "edit"; card: CardView };

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function CardDialog({
  state,
  accounts,
  onClose,
}: {
  state: CardDialogState | null;
  accounts: PayerOption[];
  onClose: () => void;
}) {
  // Keeps the last form on screen while the sheet animates out.
  const [shown, setShown] = useState(state);
  if (state && state !== shown) setShown(state);

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        {shown && (
          <CardForm
            key={shown.mode === "edit" ? shown.card.id : "create"}
            card={shown.mode === "edit" ? shown.card : null}
            accounts={accounts}
            onDone={onClose}
          />
        )}
      </ResponsiveDialogContent>
    </Dialog>
  );
}

function CardForm({
  card,
  accounts,
  onDone,
}: {
  card: CardView | null;
  accounts: PayerOption[];
  onDone: () => void;
}) {
  // Active accounts, plus the card's own account even if it was archived since.
  const payers = accounts.filter((a) => !a.archived || a.id === card?.accountId);
  const [name, setName] = useState(card?.name ?? "");
  const [accountId, setAccountId] = useState(card?.accountId ?? payers[0]?.id ?? "");
  const [closingDay, setClosingDay] = useState(String(card?.closingDay ?? ""));
  const [dueDay, setDueDay] = useState(String(card?.dueDay ?? ""));
  const [limit, setLimit] = useState(card?.limitCents ? formatBRLInput(card.limitCents) : "");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { name: useId(), account: useId(), closing: useId(), due: useId(), limit: useId() };

  if (payers.length === 0) {
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Nova conta primeiro</DialogTitle>
          <DialogDescription>
            O cartão precisa de uma conta que paga a fatura. Cadastre a conta e volte aqui.
          </DialogDescription>
        </DialogHeader>
        <ResponsiveDialogFooter>
          <Button type="button" className="h-10 w-full sm:w-auto" onClick={onDone}>
            Entendi
          </Button>
        </ResponsiveDialogFooter>
      </div>
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const input = { name, accountId, closingDay, dueDay, limit };
      const response = card
        ? await updateCardAction(card.id, input)
        : await createCardAction(input);
      setResult(response);
      if (response.ok) onDone();
    });
  }

  const today = todayInSaoPaulo();
  const closing = Number(closingDay);
  const due = Number(dueDay);
  const preview = closing && due ? invoiceFor({ closingDay: closing, dueDay: due }, today) : null;
  const cycleChanged =
    card !== null && !card.createdToday && (closing !== card.closingDay || due !== card.dueDay);
  const shortMonthHint = closing >= 29 || due >= 29;

  const fieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const knownFields = ["name", "accountId", "closingDay", "dueDay", "limit"];
  const formError =
    result && !result.ok && !knownFields.some((f) => fieldErrors[f]) ? result.error : null;
  const invalid = (id: string, error?: string) =>
    error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{card ? `Editar ${card.name}` : "Novo cartão"}</DialogTitle>
        <DialogDescription className="sr-only">
          Nome, conta, fechamento, vencimento e limite do cartão.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor={ids.name}>Nome</Label>
        <Input
          id={ids.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={CARD_NAME_MAX}
          autoComplete="off"
          {...invalid(ids.name, fieldErrors.name)}
        />
        <ErrorText id={ids.name} error={fieldErrors.name} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={ids.account}>Conta que paga a fatura</Label>
        <NativeSelect
          id={ids.account}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          {...invalid(ids.account, fieldErrors.accountId)}
        >
          {payers.map((a) => (
            <option key={a.id} value={a.id}>
              {a.archived ? `${a.name} (arquivada)` : a.name}
            </option>
          ))}
        </NativeSelect>
        <ErrorText id={ids.account} error={fieldErrors.accountId} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor={ids.closing}>Fecha dia</Label>
          <NativeSelect
            id={ids.closing}
            value={closingDay}
            onChange={(e) => setClosingDay(e.target.value)}
            {...invalid(ids.closing, fieldErrors.closingDay)}
          >
            <option value="" disabled>
              Escolha
            </option>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </NativeSelect>
          <ErrorText id={ids.closing} error={fieldErrors.closingDay} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={ids.due}>Vence dia</Label>
          <NativeSelect
            id={ids.due}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            {...invalid(ids.due, fieldErrors.dueDay)}
          >
            <option value="" disabled>
              Escolha
            </option>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </NativeSelect>
          <ErrorText id={ids.due} error={fieldErrors.dueDay} />
        </div>
      </div>

      <div aria-live="polite" className="grid gap-2 text-sm">
        {preview && (
          <p className="rounded-lg bg-muted px-3 py-2">
            Uma compra hoje cai na fatura que fecha em{" "}
            {formatCalendarDate(preview.closingDate).slice(0, 5)} e vence em{" "}
            {formatCalendarDate(preview.dueDate)}.
          </p>
        )}
        {shortMonthHint && (
          <p className="text-muted-foreground">Nos meses mais curtos, vale o último dia do mês.</p>
        )}
        {cycleChanged && (
          <p className="text-amber-700 dark:text-amber-300">
            A mudança vale para compras a partir de hoje. As anteriores continuam nas faturas de
            antes.
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={ids.limit}>
          Limite <span className="font-normal text-muted-foreground">(opcional)</span>
          <span className="sr-only"> em reais</span>
        </Label>
        <MoneyInput
          id={ids.limit}
          value={limit}
          onValueChange={setLimit}
          placeholder="0,00"
          {...invalid(ids.limit, fieldErrors.limit)}
        />
        <ErrorText id={ids.limit} error={fieldErrors.limit} />
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <ResponsiveDialogFooter>
        <Button type="submit" disabled={pending} className="h-10 w-full sm:w-auto">
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}

function ErrorText({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} className="text-sm text-destructive">
      {error}
    </p>
  );
}
