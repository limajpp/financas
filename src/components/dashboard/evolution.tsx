import type { CalendarDate } from "@/domain/dates";
import type { EvolutionMonth } from "@/domain/metrics";
import { formatBRL } from "@/domain/money";
import type { Month } from "@/domain/recurring";

import { EvolutionChartLazy } from "./evolution-chart-lazy";
import { evolutionPoints } from "./evolution-data";

const LEGEND = [
  { label: "Receitas", swatch: "size-2.5 rounded-sm bg-chart-income" },
  { label: "Despesas", swatch: "size-2.5 rounded-sm bg-chart-expense" },
  { label: "Sobra", swatch: "h-0.5 w-3.5 rounded-full bg-chart-leftover" },
];

/**
 * The 6-month evolution (task 25): the legend, the chart and its numbers as a table, visible on
 * demand (the chart's light leftover green relies on it, and so do screen readers).
 */
export function Evolution({
  evolution,
  month,
  historyStart,
}: {
  evolution: EvolutionMonth[];
  month: Month;
  historyStart: CalendarDate;
}) {
  const points = evolutionPoints(evolution, month, historyStart);
  return (
    <section aria-labelledby="evolution-title" className="grid gap-3">
      <h3 id="evolution-title" className="text-sm font-medium text-muted-foreground">
        Evolução de 6 meses
      </h3>
      <div aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {LEGEND.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5">
            <span className={l.swatch} />
            {l.label}
          </span>
        ))}
      </div>
      <div aria-hidden>
        <EvolutionChartLazy points={points} />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground underline underline-offset-4">
          Ver os números
        </summary>
        <table className="mt-2 w-full text-right text-xs tabular-nums">
          <caption className="sr-only">Receitas, despesas e sobra dos últimos 6 meses</caption>
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 text-left font-normal">
                Mês
              </th>
              <th scope="col" className="py-1 font-normal">
                Receitas
              </th>
              <th scope="col" className="py-1 font-normal">
                Despesas
              </th>
              <th scope="col" className="py-1 font-normal">
                Sobra
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.month} className="border-t" aria-current={p.selected ? "true" : undefined}>
                <th scope="row" className="py-1 text-left font-normal first-letter:uppercase">
                  {p.long}
                  {p.note && <span className="text-muted-foreground"> ({p.note})</span>}
                </th>
                {p.income === null ? (
                  <td colSpan={3} className="py-1 text-muted-foreground">
                    Antes de usar o app
                  </td>
                ) : (
                  <>
                    <td className="py-1">{formatBRL(p.income)}</td>
                    <td className="py-1">{formatBRL(p.expense!)}</td>
                    <td className="py-1">{formatBRL(p.leftover!)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
