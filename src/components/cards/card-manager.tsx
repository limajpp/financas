"use client";

import { Archive, ArchiveRestore, CreditCard, Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";

import { setCardArchivedAction } from "@/app/(app)/contas/card-actions";
import { Button } from "@/components/ui/button";
import { formatCalendarDate } from "@/domain/dates";
import { formatBRL } from "@/domain/money";
import { cn } from "@/lib/utils";

import { CardDialog, type CardDialogState } from "./card-dialog";
import type { CardView, PayerOption } from "./types";

/** The "Cartões de crédito" section of the accounts screen. */
export function CardManager({
  cards,
  accounts,
  showArchived,
}: {
  cards: CardView[];
  accounts: PayerOption[];
  showArchived: boolean;
}) {
  const [dialog, setDialog] = useState<CardDialogState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleArchived(card: CardView) {
    setError(null);
    startTransition(async () => {
      const result = await setCardArchivedAction(card.id, !card.archived);
      if (!result.ok) setError(result.error);
    });
  }

  const visible = showArchived ? cards : cards.filter((c) => !c.archived);

  return (
    <section aria-labelledby="cards-heading" id="cartoes" className="mt-10 scroll-mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cards-heading" className="text-lg font-semibold tracking-tight">
          Cartões de crédito
        </h2>
        <Button
          variant="outline"
          className="h-10 gap-2"
          onClick={() => setDialog({ mode: "create" })}
        >
          <Plus aria-hidden />
          Novo cartão
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="mt-4 text-muted-foreground">
          {cards.length > 0
            ? "Todos os cartões estão arquivados."
            : "Nenhum cartão ainda. Cadastre com os dias de fechamento e vencimento da fatura."}
        </p>
      ) : (
        <ul aria-label="Cartões" className="mt-4 divide-y rounded-lg border">
          {visible.map((card) => (
            <li
              key={card.id}
              className={cn("flex items-center gap-3 px-3 py-3", card.archived && "opacity-60")}
            >
              <CreditCard aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  <span className="truncate">{card.name}</span>
                  {card.archived && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                      Arquivado
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  Paga com {card.accountName} · Fecha dia {card.closingDay} · vence dia{" "}
                  {card.dueDay}
                </p>
                <p className="text-sm text-muted-foreground">
                  Fatura aberta vence em {formatCalendarDate(card.openInvoice.dueDate)}
                  {card.limitCents !== null && (
                    <>
                      {" "}
                      · Limite <span className="tabular-nums">{formatBRL(card.limitCents)}</span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Editar ${card.name}`}
                  onClick={() => setDialog({ mode: "edit", card })}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${card.archived ? "Desarquivar" : "Arquivar"} ${card.name}`}
                  disabled={pending}
                  onClick={() => toggleArchived(card)}
                >
                  {card.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CardDialog state={dialog} accounts={accounts} onClose={() => setDialog(null)} />
    </section>
  );
}
