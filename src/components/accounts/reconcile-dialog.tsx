"use client";

import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { compareBalanceAction, reconcileAccountAction } from "@/app/(app)/contas/reconcile-actions";
import { deleteTransactionAction } from "@/app/(app)/lancamentos/actions";
import { MoneyInput } from "@/components/money-input";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { describeItem } from "@/components/transactions/describe-item";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatCalendarDate } from "@/domain/dates";
import { formatBRL, parseBRL } from "@/domain/money";
import { reconciliationDiff } from "@/domain/reconciliation";
import { cn } from "@/lib/utils";
import type { Comparison } from "@/server/reconciliation";

import type { AccountView } from "./types";

const failed = "Não foi possível conferir. Verifique a conexão e tente de novo.";

/** "Conferir saldo" (task 21): the bank's balance, the difference and what to do about it. */
export function ReconcileDialog({
  account,
  onClose,
}: {
  account: AccountView | null;
  onClose: () => void;
}) {
  // Keeps the last content on screen while the sheet animates out.
  const [shown, setShown] = useState(account);
  if (account && account !== shown) setShown(account);
  return (
    <Dialog open={account !== null} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        {shown && <ReconcileForm key={shown.id} account={shown} onDone={onClose} />}
      </ResponsiveDialogContent>
    </Dialog>
  );
}

function ReconcileForm({ account, onDone }: { account: AccountView; onDone: () => void }) {
  const ids = { amount: useId(), negative: useId() };
  const [amount, setAmount] = useState("");
  const [negative, setNegative] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // One id per adjustment: a double tap or a retry doesn't create two.
  const clientId = useRef<string | null>(null);

  function compare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = parseBRL(amount);
    if (typed === null) {
      setError("Informe o saldo. Use o formato 1.234,56.");
      return;
    }
    // A "-" typed in the field also counts; the switch is for keypads without one (iPhone).
    const cents = negative ? -Math.abs(typed) : typed;
    setError(null);
    startTransition(async () => {
      try {
        const result = await compareBalanceAction(account.id, cents);
        if (!result.ok) return setError(result.error);
        clientId.current = null;
        setComparison(result);
      } catch {
        setError(failed);
      }
    });
  }

  function confirm(adjust: boolean) {
    if (!comparison) return;
    setError(null);
    clientId.current ??= crypto.randomUUID();
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof reconcileAccountAction>>;
      try {
        result = await reconcileAccountAction(
          account.id,
          comparison.bankBalanceCents,
          adjust,
          clientId.current,
          comparison.diffCents,
        );
      } catch {
        return setError(failed);
      }
      if (!result.ok) return setError(result.error);
      if (!result.reconciled) {
        // An entry came in meanwhile: compare again (the new balance and the entry that explains
        // it), with a new id for an adjustment of the new difference.
        clientId.current = null;
        try {
          const again = await compareBalanceAction(account.id, comparison.bankBalanceCents);
          if (again.ok) setComparison(again);
          else
            setComparison({
              ...comparison,
              appBalanceCents: result.appBalanceCents,
              ...reconciliationDiff(result.appBalanceCents, comparison.bankBalanceCents),
            });
        } catch {
          setComparison({
            ...comparison,
            appBalanceCents: result.appBalanceCents,
            ...reconciliationDiff(result.appBalanceCents, comparison.bankBalanceCents),
          });
        }
        return setError("O saldo do app mudou desde a comparação. Confira os valores de novo.");
      }
      const adjustment = result.adjustment;
      if (adjustment) {
        const adjustmentId = adjustment.id;
        toast(`Ajuste de ${formatBRL(adjustment.amountCents)} criado`, {
          duration: 5_000,
          action: {
            label: "Desfazer",
            onClick: async () => {
              try {
                const undone = await deleteTransactionAction(adjustmentId);
                if (undone.ok) toast("Ajuste desfeito.");
                else toast.error(undone.error);
              } catch {
                toast.error("Não foi possível desfazer. Verifique a conexão.");
              }
            },
          },
        });
      } else {
        toast("Conta conferida");
      }
      onDone();
    });
  }

  if (comparison) {
    const gap = formatBRL(Math.abs(comparison.diffCents));
    const register = `/registrar?${new URLSearchParams({
      valor: String(Math.abs(comparison.diffCents)),
      tipo: comparison.direction === "MISSING_EXPENSE" ? "despesa" : "receita",
      conta: account.id,
    })}`;
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Conferir saldo · {account.name}</DialogTitle>
          <DialogDescription className="sr-only">
            A comparação do saldo do app com o do banco.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">No app</dt>
            <dd className="font-medium tabular-nums">{formatBRL(comparison.appBalanceCents)}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">No banco</dt>
            <dd className="font-medium tabular-nums">{formatBRL(comparison.bankBalanceCents)}</dd>
          </div>
        </dl>

        <p
          role="status"
          className={cn(
            "text-sm font-medium",
            comparison.direction === "MATCH"
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-800 dark:text-amber-300",
          )}
        >
          {comparison.direction === "MATCH"
            ? "O saldo bate com o banco."
            : comparison.direction === "MISSING_EXPENSE"
              ? `Faltam ${gap} em saídas: um gasto que não foi registrado?`
              : `Faltam ${gap} em entradas: um recebimento que não foi registrado?`}
        </p>

        <section aria-labelledby="reconcile-entries" className="grid gap-1.5">
          <h3 id="reconcile-entries" className="text-sm font-medium">
            Últimos lançamentos da conta
          </h3>
          {comparison.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lançamento ainda.</p>
          ) : (
            <ul aria-labelledby="reconcile-entries" className="divide-y rounded-lg border">
              {comparison.entries.map((item) => {
                const { title, amount: shownAmount } = describeItem(item);
                const out =
                  item.type === "EXPENSE" ||
                  item.type === "CARD_PAYMENT" ||
                  (item.type === "TRANSFER" && item.account?.id === account.id);
                return (
                  <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-12 shrink-0 text-muted-foreground tabular-nums">
                      {formatCalendarDate(item.date).slice(0, 5)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        !out && "text-emerald-700 dark:text-emerald-400",
                      )}
                    >
                      {item.type === "TRANSFER"
                        ? `${out ? "−" : "+"}${formatBRL(item.amountCents)}`
                        : item.type === "CARD_PAYMENT"
                          ? `−${formatBRL(item.amountCents)}`
                          : shownAmount}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <ResponsiveDialogFooter className="flex-wrap gap-2">
          <Button
            variant="ghost"
            className="h-10"
            disabled={pending}
            onClick={() => {
              setComparison(null);
              setError(null);
            }}
          >
            Voltar
          </Button>
          {comparison.direction === "MATCH" ? (
            <Button className="h-10" disabled={pending} onClick={() => confirm(false)}>
              Marcar como conferido
            </Button>
          ) : (
            <>
              <Button asChild variant="outline" className="h-10">
                {/* The dialog closes: after registering, you come back and compare again. */}
                <Link href={register} onClick={onDone}>
                  Registrar o que falta
                </Link>
              </Button>
              <Button className="h-10" disabled={pending} onClick={() => confirm(true)}>
                Criar ajuste de {gap}
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={compare} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Conferir saldo · {account.name}</DialogTitle>
        <DialogDescription>
          Abra o app do banco e digite o saldo que ele mostra hoje.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.amount}>
          Saldo no app do banco hoje<span className="sr-only"> em reais</span>
        </Label>
        <MoneyInput
          id={ids.amount}
          value={amount}
          onValueChange={setAmount}
          placeholder="0,00"
          autoFocus
        />
        <label htmlFor={ids.negative} className="flex items-center gap-2 text-sm">
          <input
            id={ids.negative}
            type="checkbox"
            checked={negative}
            onChange={(e) => setNegative(e.target.checked)}
          />
          Saldo negativo (cheque especial)
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ResponsiveDialogFooter>
        <Button type="submit" disabled={pending} className="h-10 w-full sm:w-auto">
          {pending ? "Comparando…" : "Comparar"}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}
