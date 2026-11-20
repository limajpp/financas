import "server-only";

import { calendarDateToDb, todayInSaoPaulo } from "@/domain/dates";
import { rankCounterparties } from "@/domain/counterparties";
import { subscriptionTotals } from "@/domain/subscriptions";
import { db } from "@/lib/db";
import { listCards } from "@/server/cards";
import { counterpartyRanking } from "@/server/counterparties";
import { generateRecurringSafely } from "@/server/recurring";
import { recentItems } from "@/server/transaction-list";
import { cardsInvoices } from "@/server/transactions";

/** How many entries the home lists. */
export const RECENT_ITEMS = 5;

/**
 * What the home shows besides the month's metrics (task 25), always of today: the expense of the
 * day (what counts in the indicators, task 23), the open invoice of each active card, the latest
 * entries, and the shortcuts' context (the counterparty with the most this month, the
 * subscriptions per month). Whether the space registered any expense or income yet, for the empty
 * state. Everything inside the space.
 */
export async function homeSummary(spaceId: string) {
  // The subscriptions charged up to today first (task 13): a charge of today is today's expense.
  await generateRecurringSafely(spaceId);
  const today = todayInSaoPaulo();
  const [spentToday, cards, recent, rules, ranking, anyEntry] = await Promise.all([
    db.transaction.aggregate({
      where: { spaceId, type: "EXPENSE", adjustment: false, date: calendarDateToDb(today) },
      _sum: { amountCents: true },
    }),
    listCards(spaceId),
    recentItems(spaceId, today, RECENT_ITEMS),
    db.recurringRule.findMany({
      where: { spaceId, status: "ACTIVE" },
      select: { status: true, amountCents: true },
    }),
    counterpartyRanking(spaceId, "mes"),
    db.transaction.findFirst({
      where: { spaceId, type: { in: ["EXPENSE", "INCOME"] }, adjustment: false },
      select: { id: true },
    }),
  ]);
  const invoices = await cardsInvoices(
    spaceId,
    cards.map((card) => ({ id: card.id, accountId: card.account.id, cycles: card.cycles })),
  );
  const top = rankCounterparties(ranking, "value")[0] ?? null;
  return {
    today,
    todayExpenseCents: spentToday._sum.amountCents ?? 0,
    // Today's open invoice of each active card: invoiceSummaries always has it.
    cards: cards.map((card) => {
      const open = invoices.get(card.id)!.invoices.find((i) => i.status === "open")!;
      return { id: card.id, name: card.name, dueDate: open.dueDate, totalCents: open.totalCents };
    }),
    recent,
    subscriptions: subscriptionTotals(rules),
    topCounterparty: top && { id: top.id, name: top.name, totalCents: top.totalCents },
    hasEntries: anyEntry !== null,
  };
}

export type HomeSummary = Awaited<ReturnType<typeof homeSummary>>;
