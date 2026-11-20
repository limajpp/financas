"use client";

import { ChevronDown, Tag } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CategoryIcon } from "@/components/categories/category-icon";
import { categoryVariation } from "@/domain/dashboard";
import type { CategoryTotal } from "@/domain/metrics";
import { formatBRL } from "@/domain/money";
import type { Month } from "@/domain/recurring";
import { cn } from "@/lib/utils";

import { categoryEntriesHref } from "./links";

export type CategoryRow = CategoryTotal & { look: { icon: string; color: string } | null };

/** How many rows a phone shows before "Ver todas". */
const PHONE_ROWS = 5;

/**
 * The month's expenses by main category against their 3-month average (task 25): a bar of the
 * total and a mark at the average, on one scale for every row, with the variation beside it.
 * Not a pie: the question is "did I spend more than usual?". A row with subcategories opens to
 * them; the others lead to the month's entries.
 */
export function CategoryList({ rows, month }: { rows: CategoryRow[]; month: Month }) {
  const [all, setAll] = useState(false);
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.totalCents, r.averageCents ?? 0)));
  const hidden = rows.length - PHONE_ROWS;
  return (
    <div className="grid gap-3">
      <Legend withAverage={rows.some((r) => r.averageCents !== null)} />
      <ul className="grid gap-1">
        {rows.map((row, i) => (
          <li key={row.id ?? "none"} className={cn(i >= PHONE_ROWS && !all && "hidden md:block")}>
            <Row row={row} month={month} scale={scale} />
          </li>
        ))}
      </ul>
      {hidden > 0 && !all && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="justify-self-start text-sm underline underline-offset-4 md:hidden"
        >
          Ver todas as {rows.length} categorias
        </button>
      )}
    </div>
  );
}

function Legend({ withAverage }: { withAverage: boolean }) {
  return (
    <div aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-chart-expense" />
        Gasto no mês
      </span>
      {withAverage && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 rounded-full bg-foreground" />
          Média dos 3 meses anteriores
        </span>
      )}
    </div>
  );
}

function Row({ row, month, scale }: { row: CategoryRow; month: Month; scale: number }) {
  const variation = categoryVariation(row.totalCents, row.averageCents);
  const body = (
    <div className="grid w-full gap-1.5">
      <div className="flex items-center gap-3">
        {row.look ? (
          <CategoryIcon icon={row.look.icon} color={row.look.color} />
        ) : (
          <span
            aria-hidden
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <Tag className="size-4" />
          </span>
        )}
        <div className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium">{row.name}</span>
          {row.averageCents !== null && (
            <span className="text-xs text-muted-foreground">
              média {formatBRL(row.averageCents)}
            </span>
          )}
        </div>
        <div className="grid justify-items-end">
          <span className="text-sm font-medium tabular-nums">{formatBRL(row.totalCents)}</span>
          {variation && (
            <span
              className={cn(
                "text-xs tabular-nums",
                variation.alert ? "font-medium text-destructive" : "text-muted-foreground",
              )}
            >
              {variation.text}
              <span className="sr-only"> em relação à média</span>
            </span>
          )}
        </div>
      </div>
      <Bar total={row.totalCents} average={row.averageCents} scale={scale} />
    </div>
  );

  if (row.children.length === 0) {
    return (
      <Link
        href={categoryEntriesHref(row.id, month)}
        className="-mx-2 flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-muted"
      >
        {body}
        {/* The chevron's room in the rows that open: the totals line up. */}
        <span aria-hidden className="size-4 shrink-0" />
      </Link>
    );
  }
  return (
    <details className="group -mx-2 rounded-lg px-2 py-2 open:bg-muted/40">
      <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
        {body}
        <ChevronDown
          aria-hidden
          className="mt-2 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <ul className="mt-2 grid gap-1 pl-11">
        {row.children.map((child) => (
          <li key={`${child.id}:${child.direct ? "direct" : "child"}`}>
            <Link
              href={categoryEntriesHref(child.id, month)}
              className="flex justify-between gap-3 rounded-md py-1 text-sm hover:underline"
            >
              <span>{child.direct ? `${child.name} (direto)` : child.name}</span>
              <span className="tabular-nums">{formatBRL(child.totalCents)}</span>
            </Link>
          </li>
        ))}
        <li>
          <Link
            href={categoryEntriesHref(row.id, month)}
            className="text-sm underline underline-offset-4"
          >
            Ver os lançamentos de {row.name}
          </Link>
        </li>
      </ul>
    </details>
  );
}

/** The total's bar and the average's mark, on the list's common scale. Decorative: the numbers are text. */
function Bar({ total, average, scale }: { total: number; average: number | null; scale: number }) {
  return (
    <div aria-hidden className="relative h-2 rounded-full bg-muted">
      {total > 0 && (
        <div
          className="h-2 rounded-full bg-chart-expense"
          style={{ width: `${Math.max(1, (total / scale) * 100)}%` }}
        />
      )}
      {average !== null && average > 0 && (
        <div
          className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
          style={{ left: `${(average / scale) * 100}%` }}
        />
      )}
    </div>
  );
}
