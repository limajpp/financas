import "server-only";

import { isCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { invoiceSummaries, isPayableInvoice } from "@/domain/invoices";
import { listCards } from "@/server/cards";
import { invoiceItems } from "@/server/transaction-list";
import { cardsInvoices } from "@/server/transactions";

/**
 * The invoices screen (task 18): every card of the space, the active ones first (in pt-BR
 * order), then the archived ones, each with all its invoices. A fixed number of queries.
 */
export async function cardsOverview(spaceId: string) {
  const cards = await listCards(spaceId, { includeArchived: true });
  const invoices = await cardsInvoices(
    spaceId,
    cards.map((card) => ({ id: card.id, accountId: card.account.id, cycles: card.cycles })),
  );
  return [...cards.filter((c) => !c.archivedAt), ...cards.filter((c) => c.archivedAt)].map(
    (card) => ({ ...card, payment: invoices.get(card.id)! }),
  );
}

export type CardOverview = Awaited<ReturnType<typeof cardsOverview>>[number];

/**
 * One invoice of a card of the space: its summary and its entries (purchases, refunds and
 * payments). null when the card isn't in the space or doesn't have that invoice: no entry falls on
 * it and it isn't one of the payable ones (task 11).
 */
export async function invoiceDetail(spaceId: string, cardId: string, dueDate: string) {
  if (!isCalendarDate(dueDate)) return null;
  const card = (await cardsOverview(spaceId)).find((c) => c.id === cardId);
  if (!card) return null;
  let summary = card.payment.invoices.find((i) => i.dueDate === dueDate);
  if (!summary) {
    const today = todayInSaoPaulo();
    if (!isPayableInvoice(dueDate, [], card.cycles, today)) return null;
    // A payable invoice with nothing on it yet: an empty summary.
    summary = invoiceSummaries(
      [{ invoiceDueDate: dueDate, amountCents: 0 }],
      [],
      card.cycles,
      today,
    ).find((i) => i.dueDate === dueDate)!;
  }
  const items = await invoiceItems(spaceId, card.id, dueDate);
  return { card, summary, items };
}

export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof invoiceDetail>>>;
