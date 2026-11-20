import type { Kpi } from "@/domain/dashboard";
import { cn } from "@/lib/utils";

/** The four numbers at the top (task 25): label, value and one line of context each. */
export function KpiCards({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {kpis.map((kpi) => (
        <div
          key={kpi.key}
          role="group"
          aria-label={kpi.label}
          className="grid content-start gap-1 rounded-xl border bg-card p-3 md:p-4"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm text-muted-foreground">{kpi.label}</span>
            {kpi.estimate && (
              <span className="rounded-full border px-2 py-px text-xs text-muted-foreground">
                estimativa
              </span>
            )}
          </div>
          <span
            className={cn(
              "text-xl font-semibold tracking-tight md:text-2xl",
              kpi.negative && "text-destructive",
              kpi.estimate && "text-muted-foreground",
            )}
          >
            {kpi.value}
          </span>
          <span className="text-xs text-muted-foreground">{kpi.context}</span>
        </div>
      ))}
    </div>
  );
}
