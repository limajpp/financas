"use client";

import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";

import { setAccountArchivedAction } from "@/app/(app)/contas/actions";
import { COLOR_CLASSES } from "@/components/palette";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatCalendarDate } from "@/domain/dates";
import { formatBRL } from "@/domain/money";
import type { PaletteColor } from "@/domain/palette";
import { cn } from "@/lib/utils";

import { CardManager } from "@/components/cards/card-manager";
import type { CardView } from "@/components/cards/types";

import { AccountDialog, type AccountDialogState } from "./account-dialog";
import type { AccountView } from "./types";

/** The accounts screen: accounts first, then the credit cards they pay. One archived toggle for both. */
export function AccountManager({
  accounts,
  cards,
}: {
  accounts: AccountView[];
  cards: CardView[];
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<AccountDialogState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleArchived(account: AccountView) {
    setError(null);
    startTransition(async () => {
      const result = await setAccountArchivedAction(account.id, !account.archived);
      if (!result.ok) setError(result.error);
    });
  }

  const visible = showArchived ? accounts : accounts.filter((a) => !a.archived);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button className="h-10 gap-2" onClick={() => setDialog({ mode: "create" })}>
          <Plus aria-hidden />
          Nova conta
        </Button>
        <div className="flex items-center gap-2">
          <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-archived">Mostrar arquivadas</Label>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="mt-6 text-muted-foreground">
          {accounts.length > 0
            ? "Todas as contas estão arquivadas. Ligue “Mostrar arquivadas” para vê-las."
            : "Nenhuma conta ainda. Cadastre as contas do seu banco com o saldo de hoje."}
        </p>
      ) : (
        <ul aria-label="Contas" className="mt-4 divide-y rounded-lg border">
          {visible.map((account) => (
            <li
              key={account.id}
              className={cn(
                "flex min-h-16 items-center gap-3 px-3 py-2",
                account.archived && "opacity-60",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-3 shrink-0 rounded-full",
                  (COLOR_CLASSES[account.color as PaletteColor] ?? COLOR_CLASSES.slate).swatch,
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  <span className="truncate">{account.name}</span>
                  {account.archived && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                      Arquivada
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  Saldo inicial{" "}
                  <span
                    className={cn(
                      "tabular-nums",
                      account.initialBalanceCents < 0 && "text-destructive",
                    )}
                  >
                    {formatBRL(account.initialBalanceCents)}
                  </span>{" "}
                  em {formatCalendarDate(account.initialBalanceDate)}
                </p>
              </div>
              <p
                className={cn(
                  "shrink-0 text-right font-semibold tabular-nums",
                  account.currentBalanceCents < 0 && "text-destructive",
                )}
              >
                <span className="sr-only">Saldo atual </span>
                {formatBRL(account.currentBalanceCents)}
              </p>
              <div className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Editar ${account.name}`}
                  onClick={() => setDialog({ mode: "edit", account })}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${account.archived ? "Desarquivar" : "Arquivar"} ${account.name}`}
                  disabled={pending}
                  onClick={() => toggleArchived(account)}
                >
                  {account.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AccountDialog state={dialog} onClose={() => setDialog(null)} />

      <CardManager
        cards={cards}
        accounts={accounts.map(({ id, name, archived }) => ({ id, name, archived }))}
        showArchived={showArchived}
      />
    </div>
  );
}
