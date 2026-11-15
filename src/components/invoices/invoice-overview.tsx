"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CardPaymentDialog, type PayableCard } from "@/components/cards/card-payment-dialog";
import type { PayerOption } from "@/components/cards/types";
import { Button } from "@/components/ui/button";
import { formatCalendarDate } from "@/domain/dates";
import { type InvoiceSummary, groupInvoices } from "@/domain/invoices";
import { formatBRL } from "@/domain/money";

import { InvoiceStatus } from "./invoice-status";

/** How many closed invoices show before "Mostrar anteriores". */
const PAST_SHOWN = 6;

export type InvoiceCardView = PayableCard & {
  archived: boolean;
  closingDay: number;
  dueDay: number;
  limitCents: number | null;
};

const invoiceHref = (cardId: string, dueDate: string) => `/faturas/${cardId}/${dueDate}`;

/** One card's invoices: the open one, the next ones and the closed ones (task 18). */
export function InvoiceOverview({
  card,
  accounts,
}: {
  card: InvoiceCardView;
  accounts: PayerOption[];
}) {
  const [paying, setPaying] = useState<PayableCard | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { open, upcoming, past } = groupInvoices(card.payment.invoices);
  const shownPast = showAll ? past : past.slice(0, PAST_SHOWN);

  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground">
        Fecha dia {card.closingDay} · vence dia {card.dueDay}
        {card.limitCents !== null && (
          <>
            {" "}
            · Limite <span className="tabular-nums">{formatBRL(card.limitCents)}</span>
          </>
        )}
      </p>

      {open && (
        <section aria-labelledby="open-invoice" className="rounded-xl border p-4">
          <h2 id="open-invoice" className="text-sm font-medium text-muted-foreground">
            Fatura atual
          </h2>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
            {formatBRL(open.totalCents)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Vence em {formatCalendarDate(open.dueDate)} · fecha em{" "}
            {formatCalendarDate(open.closingDate)}
            {open.paidCents !== 0 && (
              <>
                {" "}
                · Pago <span className="tabular-nums">{formatBRL(open.paidCents)}</span>
              </>
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline" className="h-10">
              <Link href={invoiceHref(card.id, open.dueDate)}>Ver fatura</Link>
            </Button>
            <Button className="h-10" onClick={() => setPaying({ ...card, dueDate: open.dueDate })}>
              Pagar fatura
            </Button>
          </div>
        </section>
      )}

      <InvoiceSection
        id="upcoming-invoices"
        title="Próximas"
        empty="Nenhuma fatura futura."
        cardId={card.id}
        invoices={upcoming}
      />

      <InvoiceSection
        id="past-invoices"
        title="Anteriores"
        empty="Nenhuma fatura anterior."
        cardId={card.id}
        invoices={shownPast}
        status
      >
        {!showAll && past.length > PAST_SHOWN && (
          <Button variant="ghost" className="mt-2 h-10 w-full" onClick={() => setShowAll(true)}>
            Mostrar anteriores
          </Button>
        )}
      </InvoiceSection>

      <CardPaymentDialog card={paying} accounts={accounts} onClose={() => setPaying(null)} />
    </div>
  );
}

function InvoiceSection({
  id,
  title,
  empty,
  cardId,
  invoices,
  status = false,
  children,
}: {
  id: string;
  title: string;
  empty: string;
  cardId: string;
  invoices: InvoiceSummary[];
  status?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {invoices.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul aria-labelledby={id} className="mt-2 divide-y rounded-lg border">
          {invoices.map((invoice) => (
            <li key={invoice.dueDate}>
              <Link
                href={invoiceHref(cardId, invoice.dueDate)}
                className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-muted/50"
              >
                <span className="grid min-w-0 flex-1">
                  <span className="font-medium">
                    Vence em {formatCalendarDate(invoice.dueDate)}
                  </span>
                  {status && (
                    <InvoiceStatus summary={invoice} className="mt-1 justify-self-start" />
                  )}
                </span>
                <span className="shrink-0 tabular-nums">{formatBRL(invoice.totalCents)}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {children}
    </section>
  );
}
