/** The evolution chart's points (task 25). Pure: shared by the chart and its table. */
import { isPartialFirstMonth, monthLabel } from "@/domain/dashboard";
import type { CalendarDate } from "@/domain/dates";
import type { EvolutionMonth } from "@/domain/metrics";
import type { Month } from "@/domain/recurring";

export type EvolutionPoint = {
  month: Month;
  /** "jul" on the axis; "julho de 2026" in the tooltip and the table. */
  short: string;
  long: string;
  /** Under the axis label: the first, partial month, or a month before the app. */
  note: "parcial" | "sem dados" | null;
  selected: boolean;
  partial: boolean;
  /** Null before the history: nothing was registered, which isn't zero. */
  income: number | null;
  expense: number | null;
  leftover: number | null;
};

const short = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" });

export function evolutionPoints(
  evolution: readonly EvolutionMonth[],
  selected: Month,
  historyStart: CalendarDate,
): EvolutionPoint[] {
  return evolution.map((m) => {
    const partial = isPartialFirstMonth(m.month, historyStart);
    const empty = m.beforeHistory;
    return {
      month: m.month,
      short: short.format(new Date(`${m.month}-01T00:00:00Z`)).replace(".", ""),
      long: monthLabel(m.month),
      note: empty ? "sem dados" : partial ? "parcial" : null,
      selected: m.month === selected,
      partial,
      income: empty ? null : m.incomeCents,
      expense: empty ? null : m.expenseCents,
      leftover: empty ? null : m.leftoverCents,
    };
  });
}
