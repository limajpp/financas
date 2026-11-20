import "server-only";

import { todayInSaoPaulo } from "@/domain/dates";
import { subscriptionTotals } from "@/domain/subscriptions";
import { db } from "@/lib/db";
import { listCards } from "@/server/cards";
import { generateRecurringOnce } from "@/server/recurring";
import { recentItems } from "@/server/transaction-list";
import { cardsInvoices } from "@/server/transactions";

/** How many entries the home lists. */
export const RECENT_ITEMS = 5;

/**
 * What the home shows besides the month's metrics (task 25), always of today: the open invoice of
 * each active card, the latest entries and the subscriptions per month (a shortcut's context).
 * Whether the space registered any expense or income yet, for the empty state. Everything inside
 * the space. Today's expense and the month's top counterparty come with the metrics.
 */
export async function homeSummary(spaceId: string) {
  // The subscriptions charged up to today first (task 13): a charge of today is among the latest.
  await generateRecurringOnce(spaceId);
  const today = todayInSaoPaulo();
  const [cards, recent, rules, anyEntry] = await Promise.all([
    listCards(spaceId),
    recentItems(spaceId, today, RECENT_ITEMS),
    db.recurringRule.findMany({
      where: { spaceId, status: "ACTIVE" },
      select: { status: true, amountCents: true },
    }),
    db.transaction.findFirst({
      where: { spaceId, type: { in: ["EXPENSE", "INCOME"] }, adjustment: false },
      select: { id: true },
    }),
  ]);
  const invoices = await cardsInvoices(
    spaceId,
    cards.map((card) => ({ id: card.id, accountId: card.account.id, cycles: card.cycles })),
  );
  return {
    today,
    // Today's open invoice of each active card: invoiceSummaries always has it.
    cards: cards.map((card) => {
      const open = invoices.get(card.id)!.invoices.find((i) => i.status === "open")!;
      return { id: card.id, name: card.name, dueDate: open.dueDate, totalCents: open.totalCents };
    }),
    recent,
    subscriptions: subscriptionTotals(rules),
    hasEntries: anyEntry !== null,
  };
}

export type HomeSummary = Awaited<ReturnType<typeof homeSummary>>;
