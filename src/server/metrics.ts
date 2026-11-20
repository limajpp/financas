import "server-only";

import { calendarDateToDb, dbToCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import {
  EVOLUTION_MONTHS,
  type MetricsEntry,
  categoryBreakdown,
  futureCommitments,
  isMonth,
  monthProjection,
  monthSummary,
  monthlyEvolution,
} from "@/domain/metrics";
import { type Month, addMonthsToMonth, monthOf } from "@/domain/recurring";
import { db } from "@/lib/db";
import { generateRecurringSafely } from "@/server/recurring";

const categorySelect = { id: true, name: true, isFixed: true } as const;

/**
 * When the space started using the app: its creation day, or the earliest initial-balance day of
 * its accounts if that's before. Averages and the evolution only trust months from then on.
 */
async function historyStart(spaceId: string) {
  const [space, earliest] = await Promise.all([
    db.space.findUniqueOrThrow({ where: { id: spaceId }, select: { createdAt: true } }),
    db.account.aggregate({ where: { spaceId }, _min: { initialBalanceDate: true } }),
  ]);
  const created = todayInSaoPaulo(space.createdAt);
  const balance = earliest._min.initialBalanceDate;
  return balance && dbToCalendarDate(balance) < created ? dbToCalendarDate(balance) : created;
}

/**
 * The dashboard's numbers for `month` ("YYYY-MM"), with today in São Paulo (task 23): the month's
 * summary, its projection (today's month only), the future commitments, the categories with their
 * 3-month average and the 6-month evolution. One query for the entries: from the evolution's
 * first month to the chosen one, plus everything after today's month (future installments). Null
 * for a malformed month.
 */
export async function dashboardMetrics(spaceId: string, month: string) {
  if (!isMonth(month)) return null;
  // Subscription charges due up to today first (task 13).
  await generateRecurringSafely(spaceId);
  const today = todayInSaoPaulo();
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
      },
    }),
    db.recurringRule.findMany({
      where: { spaceId, status: "ACTIVE" },
      select: { status: true, amountCents: true, dayOfMonth: true, nextMonth: true },
    }),
    historyStart(spaceId),
  ]);
  const entries: MetricsEntry[] = rows.map((row) => ({
    type: row.type,
    amountCents: row.amountCents,
    date: dbToCalendarDate(row.date),
    adjustment: row.adjustment,
    installment: row.installmentGroupId !== null,
    subscription: row.recurringRuleId !== null,
    category: row.category,
  }));
  return {
    month,
    today,
    historyStart: start,
    summary: monthSummary(entries, month),
    projection: monthProjection(entries, rules, month, today),
    commitments: futureCommitments(entries, rules, today),
    categories: categoryBreakdown(entries, month, start),
    evolution: monthlyEvolution(entries, month, start),
  };
}

export type DashboardMetrics = NonNullable<Awaited<ReturnType<typeof dashboardMetrics>>>;
