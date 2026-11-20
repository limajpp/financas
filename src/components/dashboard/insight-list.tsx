import { Info, TriangleAlert } from "lucide-react";
import Link from "next/link";

import type { Insight } from "@/domain/insights";
import type { Month } from "@/domain/recurring";

import { insightHref } from "./links";

/**
 * The 2–3 insights of the month (task 24), each a link to its subject. An icon, with its name for
 * screen readers, tells an alert from a standing fact: never the color alone.
 */
export function InsightList({
  insights,
  month,
  note,
}: {
  insights: Insight[];
  month: Month;
  /** Said when there's none, after "Nada fora do comum neste mês." */
  note: string | null;
}) {
  return (
    <section aria-labelledby="insights-title" className="grid gap-2">
      <h3 id="insights-title" className="text-sm font-medium text-muted-foreground">
        Destaques
      </h3>
      {insights.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nada fora do comum neste mês.{note && ` ${note}`}
        </p>
      ) : (
        <ul className="grid gap-1">
          {insights.map((insight) => {
            const alert = insight.group === "alert";
            const Icon = alert ? TriangleAlert : Info;
            return (
              <li key={`${insight.kind}:${insight.text}`}>
                <Link
                  href={insightHref(insight.subject, month)}
                  className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted"
                >
                  <Icon
                    aria-hidden
                    className={
                      alert
                        ? "mt-0.5 size-4 shrink-0 text-destructive"
                        : "mt-0.5 size-4 shrink-0 text-muted-foreground"
                    }
                  />
                  <span className="text-sm">
                    <span className="sr-only">{alert ? "Alerta: " : "Informação: "}</span>
                    {insight.text}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
