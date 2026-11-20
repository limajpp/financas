import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import type { Month } from "@/domain/recurring";

import { monthHref } from "./links";

type Nav = { label: string; previous: Month | null; next: Month | null; isCurrent: boolean };

/**
 * The month of the summary (task 25): arrows to the previous month (down to the history's first)
 * and the next (up to today's), and a way back to this month. The month travels in the URL.
 */
export function MonthSelector({ nav, current }: { nav: Nav; current: Month }) {
  const arrow =
    "inline-flex size-10 items-center justify-center rounded-lg border hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-center gap-2">
        {nav.previous ? (
          <Link
            href={monthHref(nav.previous, nav.previous === current)}
            aria-label="Mês anterior"
            className={arrow}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
        ) : (
          <span aria-hidden className={`${arrow} opacity-30`}>
            <ChevronLeft className="size-4" />
          </span>
        )}
        <h2
          id="resumo"
          className="min-w-40 text-center text-lg font-semibold first-letter:uppercase"
        >
          {nav.label}
        </h2>
        {nav.next ? (
          <Link
            href={monthHref(nav.next, nav.next === current)}
            aria-label="Próximo mês"
            className={arrow}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <span aria-hidden className={`${arrow} opacity-30`}>
            <ChevronRight className="size-4" />
          </span>
        )}
      </div>
      {!nav.isCurrent && (
        <Link href="/" className="text-sm underline underline-offset-4 hover:text-foreground">
          Voltar para este mês
        </Link>
      )}
    </div>
  );
}
