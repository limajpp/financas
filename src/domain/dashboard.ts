/**
 * What the dashboard shows of the metrics (task 25): the KPIs as text, the month selector and the
 * categories' variation. Pure functions only: the numbers come ready from src/domain/metrics.ts.
 * Spec: docs/specs/tasks/25-dashboard.md.
 */
import type { CalendarDate } from "./dates";
import { isAboveAverage } from "./insights";
import {
  AVERAGE_MONTHS,
  COMMITMENT_MONTHS,
  type FutureCommitments,
  type MonthProjection,
  type MonthSummary,
  isMonth,
} from "./metrics";
import { formatBRL } from "./money";
import { type Month, addMonthsToMonth, monthOf } from "./recurring";

/** Before this day of the month, the projection is only an estimate (decided in task 23). */
export const PROJECTION_FROM_DAY = 5;

const MINUS = "−";

/** A whole percentage, cut toward zero ("62%", "−12%"); "—" without a rate. */
export function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  // Rounded first at a tiny scale: 0.29 × 100 is 28.999… in floating point.
  const value = Math.trunc(Number((rate * 100).toFixed(6)));
  return value < 0 ? `${MINUS}${-value}%` : `${value}%`;
}

export type KpiInput = {
  month: Month;
  today: CalendarDate;
  summary: MonthSummary;
  /** Today's month only (null for any other). */
  projection: MonthProjection | null;
  commitments: FutureCommitments;
};

export type Kpi = {
  key: "leftover" | "savings" | "projection" | "commitments";
  label: string;
  value: string;
  context: string;
  /** A value below zero: shown in the alert color, with its sign. */
  negative: boolean;
  /** The projection before day 5: labeled "estimativa". */
  estimate: boolean;
};

/**
 * The four KPIs. In today's month the leftover and the rate are "so far" (the expense up to
 * today: installments dated later this month are in the projection), and the projection is the
 * month's; in a past month they're the month's, and the projection gives way to its expense.
 */
export function dashboardKpis({ today, summary, projection, commitments }: KpiInput): Kpi[] {
  const kpi = (k: Omit<Kpi, "negative" | "estimate"> & Partial<Kpi>): Kpi => ({
    negative: false,
    estimate: false,
    ...k,
  });
  const money = (label: string, cents: number) => `${formatBRL(cents)} de ${label}`;
  const installments =
    commitments.remainingInstallmentsCents > 0
      ? `faltam ${formatBRL(commitments.remainingInstallmentsCents)} em parcelas`
      : "sem parcelas a pagar";
  const ahead = projection
    ? `Próximos ${COMMITMENT_MONTHS} meses`
    : `Próximos ${COMMITMENT_MONTHS} meses, a partir de hoje`;
  const committed = kpi({
    key: "commitments",
    label: "Comprometido no futuro",
    value: formatBRL(commitments.totalCents),
    context: `${ahead} · ${installments}`,
  });

  if (!projection) {
    return [
      kpi({
        key: "leftover",
        label: "Sobra",
        value: formatBRL(summary.leftoverCents),
        context: `${money("receitas", summary.incomeCents)}, ${money("despesas", summary.expenseCents)}`,
        negative: summary.leftoverCents < 0,
      }),
      kpi({
        key: "savings",
        label: "Taxa de poupança",
        value: formatRate(summary.savingsRate),
        context: summary.savingsRate === null ? "Sem receitas no mês" : "Da receita do mês",
        negative: (summary.savingsRate ?? 0) < 0,
      }),
      kpi({
        key: "projection",
        label: "Despesa do mês",
        value: formatBRL(summary.expenseCents),
        context: "O valor final do mês",
      }),
      committed,
    ];
  }

  const estimate = Number(today.slice(8, 10)) < PROJECTION_FROM_DAY;
  return [
    kpi({
      key: "leftover",
      label: "Sobra até agora",
      value: formatBRL(projection.leftoverToDateCents),
      context: `${money("receitas", summary.incomeCents)}, ${money("despesas", projection.expenseToDateCents)}`,
      negative: projection.leftoverToDateCents < 0,
    }),
    kpi({
      key: "savings",
      label: "Taxa de poupança",
      value: formatRate(projection.savingsRateToDate),
      context:
        projection.savingsRateToDate === null
          ? "Sem receitas no mês"
          : "Da receita do mês, até agora",
      negative: (projection.savingsRateToDate ?? 0) < 0,
    }),
    kpi({
      key: "projection",
      label: "Projeção do mês",
      value: formatBRL(projection.projectedExpenseCents),
      context: estimate
        ? "Poucos dias para projetar."
        : `Sobra projetada: ${formatBRL(projection.projectedLeftoverCents)}`,
      estimate,
    }),
    committed,
  ];
}

const monthYear = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "novembro de 2026". */
export function monthLabel(month: Month): string {
  return monthYear.format(new Date(`${month}-01T00:00:00Z`));
}

/** The first and the last day of a month. */
export function monthDays(month: Month): { from: CalendarDate; to: CalendarDate } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * The month the dashboard shows for the URL's `?mes=`: a valid month from the history's first one
 * to today's. A month before the history opens its first; a future or invalid one, today's.
 */
export function resolveMonth(
  param: string | undefined,
  today: CalendarDate,
  historyStart: CalendarDate,
): Month {
  const current = monthOf(today);
  const first = monthOf(historyStart);
  if (!param || !isMonth(param) || param > current) return current;
  return param < first ? first : param;
}

/** The selector: the month's name, the previous one (down to the history's first) and the next. */
export function monthNav(month: Month, today: CalendarDate, historyStart: CalendarDate) {
  const current = monthOf(today);
  return {
    label: monthLabel(month),
    previous: month > monthOf(historyStart) ? addMonthsToMonth(month, -1) : null,
    next: month < current ? addMonthsToMonth(month, 1) : null,
    isCurrent: month === current,
  };
}

/**
 * A category's variation over its 3-month average ("+46%", "−12%"), cut toward zero, marked as an
 * alert by the insights' rule 1. Over a zero average it's "novo". Null without an average, or
 * with nothing spent over a zero one.
 */
export function categoryVariation(
  totalCents: number,
  averageCents: number | null,
): { text: string; alert: boolean } | null {
  if (averageCents === null) return null;
  const alert = isAboveAverage(totalCents, averageCents);
  if (averageCents === 0) return totalCents > 0 ? { text: "novo", alert } : null;
  const value = Math.trunc(((totalCents - averageCents) * 100) / averageCents);
  const text = value > 0 ? `+${value}%` : value < 0 ? `${MINUS}${-value}%` : "0%";
  return { text, alert };
}

/**
 * The first month with a 3-month average (src/domain/metrics.ts hasAverageHistory): three whole
 * months after the history's first whole one. For the empty states' "a partir de <mês>".
 */
export function firstAverageMonth(historyStart: CalendarDate): Month {
  const firstWhole = historyStart.endsWith("-01")
    ? monthOf(historyStart)
    : addMonthsToMonth(monthOf(historyStart), 1);
  return addMonthsToMonth(firstWhole, AVERAGE_MONTHS);
}

/** The history's first month when it didn't start on the 1st: the evolution draws it as partial. */
export function isPartialFirstMonth(month: Month, historyStart: CalendarDate): boolean {
  return monthOf(historyStart) === month && !historyStart.endsWith("-01");
}
