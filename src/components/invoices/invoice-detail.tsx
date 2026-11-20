"use client";

import Link from "next/link";
import { useState } from "react";

import { CardPaymentDialog, type PayableCard } from "@/components/cards/card-payment-dialog";
import type { PayerOption } from "@/components/cards/types";
import { CategoryIcon } from "@/components/categories/category-icon";
import { describeItem } from "@/components/transactions/describe-item";
import { TransactionEditDialog } from "@/components/transactions/transaction-edit-dialog";
import type { ListItemView, ListOptions } from "@/components/transactions/types";
import { Button } from "@/components/ui/button";
import { type CalendarDate, formatCalendarDate } from "@/domain/dates";
import type { InvoiceSummary } from "@/domain/invoices";
import { formatBRL } from "@/domain/money";

import { InvoiceStatus } from "./invoice-status";

/** One invoice: its totals, what fell on it and the payments (task 18). */
export function InvoiceDetailView({
  card,
  summary,
  items,
  accounts,
  options,
  today,
}: {
  card: PayableCard;
  summary: InvoiceSummary;
  items: ListItemView[];
  accounts: PayerOption[];
  options: ListOptions;
  today: CalendarDate;
}) {
  const [editing, setEditing] = useState<ListItemView | null>(null);
  const [paying, setPaying] = useState<PayableCard | null>(null);
  const entries = items.filter((i) => i.type === "EXPENSE" || i.type === "INCOME");
  const payments = items.filter((i) => i.type === "CARD_PAYMENT");
  const closed = summary.status === "closed";

  return (
    <div className="mt-4 grid gap-6">
      <section aria-label="Resumo da fatura" className="rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <InvoiceStatus summary={summary} short />
          <p className="text-sm text-muted-foreground">
            Vence em {formatCalendarDate(summary.dueDate)} · {closed ? "fechou" : "fecha"} em{" "}
            {formatCalendarDate(summary.closingDate)}
          </p>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3">
          <Amount label="Total" cents={summary.totalCents} strong />
          <Amount label="Pago" cents={summary.paidCents} />
          {summary.remainingCents < 0 ? (
            <Amount label="Crédito" cents={-summary.remainingCents} />
          ) : (
            <Amount label="Falta pagar" cents={summary.remainingCents} />
          )}
        </dl>
        {summary.remainingCents > 0 && (
          <Button
            className="mt-4 h-10"
            onClick={() => setPaying({ ...card, dueDate: summary.dueDate })}
          >
            Pagar fatura
          </Button>
        )}
      </section>

      <section aria-labelledby="invoice-entries">
        <h2 id="invoice-entries" className="text-lg font-semibold tracking-tight">
          Lançamentos
        </h2>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nenhum lançamento nesta fatura.</p>
        ) : (
          <ul aria-labelledby="invoice-entries" className="mt-2 divide-y rounded-lg border">
            {entries.map((item) => (
              <EntryRow key={item.id} item={item} onOpen={() => setEditing(item)} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="invoice-payments">
        <h2 id="invoice-payments" className="text-lg font-semibold tracking-tight">
          Pagamentos
        </h2>
        {payments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nenhum pagamento desta fatura.</p>
        ) : (
          <ul aria-labelledby="invoice-payments" className="mt-2 divide-y rounded-lg border">
            {payments.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setEditing(item)}
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
                >
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">
                      Pago em {formatCalendarDate(item.date)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {item.account?.name}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatBRL(item.amountCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p>
        <Link
          href={`/faturas?cartao=${card.id}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Ver todas as faturas do {card.name}
        </Link>
      </p>

      <TransactionEditDialog
        item={editing}
        options={options}
        today={today}
        onClose={() => setEditing(null)}
      />
      <CardPaymentDialog card={paying} accounts={accounts} onClose={() => setPaying(null)} />
    </div>
  );
}

function Amount({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          strong
            ? "truncate text-xl font-semibold tracking-tight tabular-nums"
            : "truncate pt-1 tabular-nums"
        }
      >
        {formatBRL(cents)}
      </dd>
    </div>
  );
}

function EntryRow({ item, onOpen }: { item: ListItemView; onOpen: () => void }) {
  const { title } = describeItem(item);
  const refund = item.type === "INCOME";
  const line = [
    formatCalendarDate(item.date),
    refund ? "Estorno" : null,
    // An invoice's amount from before the app (task 22).
    item.adjustment ? "Antes do app" : null,
    item.category?.name ?? null,
    item.installmentNumber ? `${item.installmentNumber}/${item.installmentTotal}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
      >
        {item.category ? (
          <CategoryIcon icon={item.category.icon} color={item.category.color} className="size-8" />
        ) : (
          <span aria-hidden className="size-8 shrink-0 rounded-lg bg-muted" />
        )}
        <span className="grid min-w-0 flex-1">
          <span className="truncate font-medium">{title}</span>
          <span className="truncate text-xs text-muted-foreground">{line}</span>
        </span>
        <span
          className={
            refund
              ? "shrink-0 text-emerald-700 tabular-nums dark:text-emerald-400"
              : "shrink-0 tabular-nums"
          }
        >
          {refund ? `−${formatBRL(item.amountCents)}` : formatBRL(item.amountCents)}
        </span>
      </button>
    </li>
  );
}
