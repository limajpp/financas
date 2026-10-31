"use client";

import { useId, useState, useTransition } from "react";

import { createAccountAction, updateAccountAction } from "@/app/(app)/contas/actions";
import { MoneyInput } from "@/components/money-input";
import { ColorPicker } from "@/components/palette";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ACCOUNT_NAME_MAX } from "@/domain/accounts";
import { type CalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { formatBRLInput } from "@/domain/money";
import type { PaletteColor } from "@/domain/palette";
import type { ActionResult } from "@/lib/action-result";

import type { AccountView } from "./types";

export type AccountDialogState = { mode: "create" } | { mode: "edit"; account: AccountView };

export function AccountDialog({
  state,
  onClose,
}: {
  state: AccountDialogState | null;
  onClose: () => void;
}) {
  // Keeps the last form on screen while the sheet animates out.
  const [shown, setShown] = useState(state);
  if (state && state !== shown) setShown(state);

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        {shown && (
          <AccountForm
            key={shown.mode === "edit" ? shown.account.id : "create"}
            account={shown.mode === "edit" ? shown.account : null}
            onDone={onClose}
          />
        )}
      </ResponsiveDialogContent>
    </Dialog>
  );
}

function AccountForm({ account, onDone }: { account: AccountView | null; onDone: () => void }) {
  const today: CalendarDate = todayInSaoPaulo();
  const [name, setName] = useState(account?.name ?? "");
  const [color, setColor] = useState<PaletteColor>((account?.color as PaletteColor) ?? "blue");
  const [initialBalance, setInitialBalance] = useState(
    account ? formatBRLInput(Math.abs(account.initialBalanceCents)) : "",
  );
  const [negative, setNegative] = useState((account?.initialBalanceCents ?? 0) < 0);
  const [initialBalanceDate, setInitialBalanceDate] = useState(
    account?.initialBalanceDate ?? today,
  );
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { name: useId(), balance: useId(), negative: useId(), date: useId() };

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const input = { name, color, initialBalance, negative, initialBalanceDate };
      const response = account
        ? await updateAccountAction(account.id, input)
        : await createAccountAction(input);
      setResult(response);
      if (response.ok) onDone();
    });
  }

  const fieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const knownFields = ["name", "initialBalance", "initialBalanceDate"];
  const formError =
    result && !result.ok && !knownFields.some((f) => fieldErrors[f]) ? result.error : null;
  const errorProps = (id: string, error?: string) =>
    error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{account ? `Editar ${account.name}` : "Nova conta"}</DialogTitle>
        <DialogDescription className="sr-only">
          Nome, cor e saldo inicial da conta.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor={ids.name}>Nome</Label>
        <Input
          id={ids.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={ACCOUNT_NAME_MAX}
          autoComplete="off"
          {...errorProps(ids.name, fieldErrors.name)}
        />
        <ErrorText id={ids.name} error={fieldErrors.name} />
      </div>

      <ColorPicker value={color} onChange={setColor} />

      <div className="grid gap-2">
        <Label htmlFor={ids.balance}>Saldo inicial</Label>
        <MoneyInput
          id={ids.balance}
          value={initialBalance}
          onValueChange={setInitialBalance}
          placeholder="0,00"
          {...errorProps(ids.balance, fieldErrors.initialBalance)}
        />
        <ErrorText id={ids.balance} error={fieldErrors.initialBalance} />
        <div className="flex items-center gap-2">
          <Switch id={ids.negative} checked={negative} onCheckedChange={setNegative} />
          <Label htmlFor={ids.negative} className="font-normal">
            Saldo negativo (cheque especial)
          </Label>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={ids.date}>Data do saldo</Label>
        <Input
          id={ids.date}
          type="date"
          value={initialBalanceDate}
          max={today}
          onChange={(e) => setInitialBalanceDate(e.target.value)}
          {...errorProps(ids.date, fieldErrors.initialBalanceDate)}
        />
        <ErrorText id={ids.date} error={fieldErrors.initialBalanceDate} />
        <p className="text-sm text-muted-foreground">
          O saldo que o banco mostrava no fim desse dia.
        </p>
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
