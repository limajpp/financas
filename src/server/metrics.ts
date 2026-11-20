import "server-only";

import { calendarDateToDb, dbToCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { type InsightEntry, type InsightRule, monthInsights } from "@/domain/insights";
import {
  EVOLUTION_MONTHS,
  categoryBreakdown,
  futureCommitments,
  isMonth,
  monthProjection,
  monthSummary,
  monthlyEvolution,
} from "@/domain/metrics";
import { type Month, addMonthsToMonth, monthOf } from "@/domain/recurring";
import { subscriptionName } from "@/domain/subscriptions";
import { db } from "@/lib/db";
import { generateRecurringSafely } from "@/server/recurring";

const categorySelect = { id: true, name: true, isFixed: true, icon: true, color: true } as const;

/**
 * When the space started using the app: its creation day, in São Paulo. Averages and the
 * evolution only trust months from then on. An account's initial balance doesn't count (decided
 * in task 24): one added later with an old balance would unlock months nobody followed.
 */
export async function spaceHistoryStart(spaceId: string) {
  const space = await db.space.findUniqueOrThrow({
    where: { id: spaceId },
    select: { createdAt: true },
  });
  return todayInSaoPaulo(space.createdAt);
}

/**
 * The dashboard's numbers for `month` ("YYYY-MM"), with today in São Paulo (task 23): the month's
 * summary, its projection (today's month only), the future commitments, the categories with their
 * 3-month average and the 6-month evolution. One query for the entries: from the evolution's
 * first month to the chosen one, plus everything after today's month (future installments). Null
 * for a malformed month. The insights (task 24) come from the same data.
 */
export async function dashboardMetrics(spaceId: string, month: string) {
  if (!isMonth(month)) return null;
  // Subscription charges due up to today first (task 13).
  await generateRecurringSafely(spaceId);
  const today = todayInSaoPaulo();
  const future = month > monthOf(today);
  const first: Month = addMonthsToMonth(month, -(EVOLUTION_MONTHS - 1));
  const afterToday = addMonthsToMonth(monthOf(today), 1);
  const [rows, rules, start] = await Promise.all([
    db.transaction.findMany({
      where: {
        spaceId,
        type: { in: ["EXPENSE", "INCOME"] },
        adjustment: false,
        OR: [
          {
            date: {
              gte: calendarDateToDb(`${first}-01`),
              lt: calendarDateToDb(`${addMonthsToMonth(month, 1)}-01`),
            },
          },
          { date: { gte: calendarDateToDb(`${afterToday}-01`) } },
        ],
      },
      select: {
        type: true,
        amountCents: true,
        date: true,
        adjustment: true,
        installmentGroupId: true,
        recurringRuleId: true,
        category: { select: { ...categorySelect, parent: { select: categorySelect } } },
        counterparty: { select: { id: true, name: true } },
      },
    }),
    db.recurringRule.findMany({
      where: { spaceId, status: "ACTIVE" },
      select: {
        id: true,
        status: true,
        amountCents: true,
        dayOfMonth: true,
        nextMonth: true,
        description: true,
        counterparty: { select: { name: true } },
        category: { select: { name: true } },
        // In the order they were made, as recentChange expects (task 19).
        changes: {
          select: { changedOn: true, previousCents: true, amountCents: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    }),
    spaceHistoryStart(spaceId),
  ]);
  const entries: InsightEntry[] = rows.map((row) => ({
    type: row.type,
    amountCents: row.amountCents,
    date: dbToCalendarDate(row.date),
    adjustment: row.adjustment,
    installment: row.installmentGroupId !== null,
    subscription: row.recurringRuleId !== null,
    category: row.category,
    counterparty: row.counterparty,
  }));
  const insightRules: InsightRule[] = rules.map((rule) => ({
    id: rule.id,
    name: subscriptionName(rule),
    status: rule.status,
    amountCents: rule.amountCents,
    changes: rule.changes.map((c) => ({ ...c, changedOn: dbToCalendarDate(c.changedOn) })),
  }));
  const breakdown = future ? null : categoryBreakdown(entries, month, start);
  // Each main category's icon and color, for the dashboard's rows (task 25).
  const looks = new Map<string, { icon: string; color: string }>();
  for (const row of rows) {
    const top = row.category?.parent ?? row.category;
    if (top) looks.set(top.id, { icon: top.icon, color: top.color });
  }
  const categories =
    breakdown?.map((c) => ({ ...c, look: c.id === null ? null : (looks.get(c.id) ?? null) })) ??
    null;
  return {
    month,
    today,
    historyStart: start,
    summary: monthSummary(entries, month),
    projection: monthProjection(entries, rules, month, today),
    commitments: futureCommitments(entries, rules, today),
    // A month not started yet has no categories or evolution: its "average" would take months
    // that haven't happened, and every category would read as "nothing spent".
    categories,
    evolution: future ? null : monthlyEvolution(entries, month, start),
    // Task 24: the 3 insights, from the data already loaded. Null for a future month too.
    insights: categories
      ? monthInsights({ month, today, entries, categories, rules: insightRules })
      : null,
  };
}

export type DashboardMetrics = NonNullable<Awaited<ReturnType<typeof dashboardMetrics>>>;
