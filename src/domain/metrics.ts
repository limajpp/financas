/**
 * The dashboard's numbers. Pure functions over entries loaded once. Spec:
 * docs/specs/tasks/23-metrics.md.
 *
 * What counts: expenses and incomes on their own date (a credit purchase in the month it was made,
 * an installment in its month). Transfers, invoice payments and adjustments (task 21's and the
 * invoices' opening balances, task 22) never count, like in src/domain/totals.ts.
 */
import type { CalendarDate } from "./dates";
import {
  type Month,
  type RuleStatus,
  addMonthsToMonth,
  monthOf,
  occurrenceDate,
} from "./recurring";
import type { TransactionType } from "./transactions";

/** How many months the evolution chart shows (the chosen one and the ones before). */
export const EVOLUTION_MONTHS = 6;
/** How many months ahead the future commitments look, from the next one. */
export const COMMITMENT_MONTHS = 6;
/** How many previous months a category's average takes. */
export const AVERAGE_MONTHS = 3;

type CategoryRef = { id: string; name: string; isFixed: boolean };

export type MetricsEntry = {
  type: TransactionType;
  amountCents: number;
  date: CalendarDate;
  adjustment: boolean;
  /** Part of a purchase in installments (task 12). */
  installment: boolean;
  /** A subscription's charge (task 13). */
  subscription: boolean;
  category: (CategoryRef & { parent: CategoryRef | null }) | null;
};

export type MetricsRule = {
  status: RuleStatus;
  amountCents: number;
  dayOfMonth: number;
  /** The first month not charged yet (src/domain/recurring.ts). */
  nextMonth: Month;
};

/** An expense or income that counts in the indicators. */
function counts(entry: MetricsEntry): entry is MetricsEntry & { type: "EXPENSE" | "INCOME" } {
  return (entry.type === "EXPENSE" || entry.type === "INCOME") && !entry.adjustment;
}

const isExpense = (e: MetricsEntry) => counts(e) && e.type === "EXPENSE";
const isIncome = (e: MetricsEntry) => counts(e) && e.type === "INCOME";
const sum = (entries: readonly MetricsEntry[]) => entries.reduce((s, e) => s + e.amountCents, 0);
const inMonth = (month: Month) => (e: MetricsEntry) => monthOf(e.date) === month;

/**
 * A fixed expense (design): a subscription's charge, an installment, or an expense whose category
 * (or its parent) is marked fixed. Everything else is variable, uncategorized included.
 */
export function isFixedExpense(entry: MetricsEntry): boolean {
  if (!isExpense(entry)) return false;
  return (
    entry.subscription ||
    entry.installment ||
    entry.category?.isFixed === true ||
    entry.category?.parent?.isFixed === true
  );
}

export type MonthSummary = {
  month: Month;
  incomeCents: number;
  expenseCents: number;
  /** income − expense; may be negative. */
  leftoverCents: number;
  /** leftover ÷ income (0.25 = 25%); null without income in the month. */
  savingsRate: number | null;
  fixedCents: number;
  variableCents: number;
};

/** Income, expense, what's left, the savings rate and fixed × variable, of one month. */
export function monthSummary(entries: readonly MetricsEntry[], month: Month): MonthSummary {
  const of = entries.filter(inMonth(month));
  const incomeCents = sum(of.filter(isIncome));
  const expenses = of.filter(isExpense);
  const expenseCents = sum(expenses);
  const fixedCents = sum(expenses.filter(isFixedExpense));
  const leftoverCents = incomeCents - expenseCents;
  return {
    month,
    incomeCents,
    expenseCents,
    leftoverCents,
    savingsRate: incomeCents > 0 ? leftoverCents / incomeCents : null,
    fixedCents,
    variableCents: expenseCents - fixedCents,
  };
}

function daysIn(month: Month) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The active subscriptions that still charge in `month` after `today`. */
function upcomingCharges(rules: readonly MetricsRule[], month: Month, today: CalendarDate) {
  return rules.filter(
    (r) =>
      r.status === "ACTIVE" && r.nextMonth <= month && occurrenceDate(r.dayOfMonth, month) > today,
  );
}

export type MonthProjection = {
  expenseToDateCents: number;
  variableToDateCents: number;
  /** The variable expenses per day so far, rounded to the cent (for display). */
  dailyPaceCents: number;
  remainingDays: number;
  /** The variable expenses still expected: the pace × the days left, rounded to the cent. */
  projectedVariableCents: number;
  /** Installments dated after today and subscription charges still to come, this month. */
  upcomingFixedCents: number;
  projectedExpenseCents: number;
  /** The month's registered income − the projected expense. */
  projectedLeftoverCents: number;
};

/**
 * Where the current month is heading: the expenses so far, plus the variable ones' daily pace
 * times the days left, plus the fixed ones the app knows will still come (installments dated
 * later this month and subscription charges not out yet). Null for any month but today's.
 */
export function monthProjection(
  entries: readonly MetricsEntry[],
  rules: readonly MetricsRule[],
  month: Month,
  today: CalendarDate,
): MonthProjection | null {
  if (monthOf(today) !== month) return null;
  const of = entries.filter(inMonth(month));
  const toDate = of.filter((e) => isExpense(e) && e.date <= today);
  const expenseToDateCents = sum(toDate);
  const variableToDateCents = sum(toDate.filter((e) => !isFixedExpense(e)));
  const elapsedDays = Number(today.slice(8, 10));
  const remainingDays = daysIn(month) - elapsedDays;
  // Registered expenses dated later this month (only installments can be: the register refuses
  // future dates).
  const laterCents = sum(of.filter((e) => isExpense(e) && e.date > today));
  const upcomingFixedCents =
    laterCents + upcomingCharges(rules, month, today).reduce((s, r) => s + r.amountCents, 0);
  // From the exact pace, not the rounded one shown: rounded once, at the end.
  const projectedVariableCents = Math.round((variableToDateCents * remainingDays) / elapsedDays);
  const projectedExpenseCents = expenseToDateCents + projectedVariableCents + upcomingFixedCents;
  return {
    expenseToDateCents,
    variableToDateCents,
    dailyPaceCents: Math.round(variableToDateCents / elapsedDays),
    remainingDays,
    projectedVariableCents,
    upcomingFixedCents,
    projectedExpenseCents,
    projectedLeftoverCents: sum(of.filter(isIncome)) - projectedExpenseCents,
  };
}

export type FutureCommitments = {
  months: {
    month: Month;
    installmentsCents: number;
    subscriptionsCents: number;
    totalCents: number;
  }[];
  /** The sum of `months`. */
  totalCents: number;
  /** Every installment from the next month on, beyond the months shown too. */
  remainingInstallmentsCents: number;
};

/**
 * What's already contracted for the next months, from the one after today's: the installments
 * dated in each month (by the installment's month, not the invoice's) and the active
 * subscriptions charging in it (from their cursor on). Paused and canceled ones don't count.
 */
export function futureCommitments(
  entries: readonly MetricsEntry[],
  rules: readonly MetricsRule[],
  today: CalendarDate,
  count = COMMITMENT_MONTHS,
): FutureCommitments {
  const current = monthOf(today);
  const installments = entries.filter(
    (e) => isExpense(e) && e.installment && monthOf(e.date) > current,
  );
  const active = rules.filter((r) => r.status === "ACTIVE");
  const months = Array.from({ length: count }, (_, i) => {
    const month = addMonthsToMonth(current, i + 1);
    const installmentsCents = sum(installments.filter(inMonth(month)));
    const subscriptionsCents = active
      .filter((r) => r.nextMonth <= month)
      .reduce((s, r) => s + r.amountCents, 0);
    return {
      month,
      installmentsCents,
      subscriptionsCents,
      totalCents: installmentsCents + subscriptionsCents,
    };
  });
  return {
    months,
    totalCents: months.reduce((s, m) => s + m.totalCents, 0),
    remainingInstallmentsCents: sum(installments),
  };
}

/**
 * Whether the app was in use for the whole of the `AVERAGE_MONTHS` months before `month`: its
 * history must start on or before the first day of the earliest of them.
 */
export function hasAverageHistory(month: Month, historyStart: CalendarDate): boolean {
  return historyStart <= `${addMonthsToMonth(month, -AVERAGE_MONTHS)}-01`;
}

export type CategoryTotal = {
  /** The main category; null for the uncategorized expenses. */
  id: string | null;
  name: string;
  totalCents: number;
  /** The average of the 3 previous months; null without enough history. */
  averageCents: number | null;
  /**
   * The subcategories' totals in the month, largest first. When there are any, the expenses
   * booked on the main category itself are a row too (with its id and name): they add up to the
   * total.
   */
  children: { id: string; name: string; totalCents: number }[];
};

export const UNCATEGORIZED = "Sem categoria";

/**
 * The month's expenses by main category (a subcategory adds to its parent), with the average of
 * the 3 previous months when there's history for it. A category with no expense this month shows
 * when its average isn't zero. Largest total first, then largest average, then name.
 */
export function categoryBreakdown(
  entries: readonly MetricsEntry[],
  month: Month,
  historyStart: CalendarDate,
): CategoryTotal[] {
  const withAverage = hasAverageHistory(month, historyStart);
  const previous = new Set(
    Array.from({ length: AVERAGE_MONTHS }, (_, i) => addMonthsToMonth(month, -(i + 1))),
  );
  type Row = CategoryTotal & {
    directCents: number;
    previousCents: number;
    childMap: Map<string, CategoryTotal["children"][number]>;
  };
  const rows = new Map<string | null, Row>();
  for (const entry of entries) {
    if (!isExpense(entry)) continue;
    const entryMonth = monthOf(entry.date);
    const current = entryMonth === month;
    if (!current && !(withAverage && previous.has(entryMonth))) continue;
    const top = entry.category?.parent ?? entry.category;
    const key = top?.id ?? null;
    let row = rows.get(key);
    if (!row) {
      row = {
        id: key,
        name: top?.name ?? UNCATEGORIZED,
        totalCents: 0,
        averageCents: null,
        children: [],
        directCents: 0,
        previousCents: 0,
        childMap: new Map(),
      };
      rows.set(key, row);
    }
    if (!current) {
      row.previousCents += entry.amountCents;
      continue;
    }
    row.totalCents += entry.amountCents;
    if (entry.category?.parent) {
      const child = row.childMap.get(entry.category.id) ?? {
        id: entry.category.id,
        name: entry.category.name,
        totalCents: 0,
      };
      child.totalCents += entry.amountCents;
      row.childMap.set(child.id, child);
    } else if (top) {
      row.directCents += entry.amountCents;
    }
  }
  return [...rows.values()]
    .map(({ previousCents, directCents, childMap, ...row }) => {
      const children = [...childMap.values()];
      if (children.length > 0 && directCents > 0 && row.id !== null) {
        children.push({ id: row.id, name: row.name, totalCents: directCents });
      }
      return {
        ...row,
        averageCents: withAverage ? Math.round(previousCents / AVERAGE_MONTHS) : null,
        children: children.sort(
          (a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, "pt-BR"),
        ),
      };
    })
    .filter((row) => row.totalCents > 0 || (row.averageCents ?? 0) > 0)
    .sort(
      (a, b) =>
        b.totalCents - a.totalCents ||
        (b.averageCents ?? 0) - (a.averageCents ?? 0) ||
        a.name.localeCompare(b.name, "pt-BR"),
    );
}

export type EvolutionMonth = MonthSummary & {
  /** The month ended before the app was in use: nothing was registered, not "zero". */
  beforeHistory: boolean;
};

/** The chosen month and the ones before it (6 in all), oldest first. */
export function monthlyEvolution(
  entries: readonly MetricsEntry[],
  month: Month,
  historyStart: CalendarDate,
  count = EVOLUTION_MONTHS,
): EvolutionMonth[] {
  return Array.from({ length: count }, (_, i) => {
    const m = addMonthsToMonth(month, i - (count - 1));
    return {
      ...monthSummary(entries, m),
      beforeHistory: `${m}-${String(daysIn(m)).padStart(2, "0")}` < historyStart,
    };
  });
}

/**
 * True for a real month in "YYYY-MM" form, from 2000 (the oldest entry date) to 2999: the
 * evolution's months before it and the one after it stay valid calendar dates.
 */
export function isMonth(value: string): value is Month {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month] = [Number(match[1]), Number(match[2])];
  return year >= 2000 && year <= 2999 && month >= 1 && month <= 12;
}
