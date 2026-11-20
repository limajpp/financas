"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { CategoryIcon } from "@/components/categories/category-icon";
import type { CounterpartyOption } from "@/components/register/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Period, type RankingOrder, rankCounterparties } from "@/domain/counterparties";
import { searchCounterparties } from "@/domain/counterparty-search";
import { formatBRL } from "@/domain/money";
import type { RankingRow } from "@/server/counterparties";

import { PeriodSelect } from "./period-select";

/** How many rows show before "Mostrar mais". */
const SHOWN = 20;

const purchasesText = (n: number) => (n === 1 ? "1 compra" : `${n} compras`);

/** The counterparties screen (task 20): search, period, and the ranking by value or frequency. */
export function CounterpartyRanking({
  period,
  rows,
  counterparties,
}: {
  period: Period;
  rows: RankingRow[];
  counterparties: CounterpartyOption[];
}) {
  const [order, setOrder] = useState<RankingOrder>("value");
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const searchId = useId();
  // Typed before the page hydrated (a slow phone, task 26): the text is in the field but not in
  // the state, and the search wouldn't run. On mount, the state takes what's already there.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const typed = searchRef.current?.value ?? "";
    if (typed !== "") setQuery(typed);
  }, []);
  const ranked = rankCounterparties(rows, order);
  const shown = showAll ? ranked : ranked.slice(0, SHOWN);
  const href = (id: string) => `/estabelecimentos/${id}?periodo=${period}`;
  const results = query.trim() === "" ? [] : searchCounterparties(query, counterparties, 8);

  return (
    <div className="mt-4 grid gap-5">
      <div className="grid gap-1.5">
        <label htmlFor={searchId} className="sr-only">
          Buscar estabelecimento
        </label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar estabelecimento"
            autoComplete="off"
            className="h-10 pl-9"
          />
        </div>
        {query.trim() !== "" && (
          <ul aria-label="Resultados da busca" className="divide-y rounded-lg border">
            {results.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                Nenhum estabelecimento encontrado.
              </li>
            ) : (
              results.map(({ counterparty, match }) => (
                <li key={counterparty.id}>
                  <Link
                    href={href(counterparty.id)}
                    className="flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-muted/50"
                  >
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{counterparty.name}</span>
                      {match.field !== "name" && (
                        <span className="truncate text-xs text-muted-foreground">
                          {match.field === "alias" ? "no extrato" : "CPF/CNPJ"}: {match.text}
                        </span>
                      )}
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Ordem" className="grid grid-cols-2 rounded-lg bg-muted p-1">
          {(
            [
              ["value", "Por valor"],
              ["frequency", "Por frequência"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={order === value}
              onClick={() => setOrder(value)}
              className="h-9 rounded-md px-3 text-sm font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
            >
              {label}
            </button>
          ))}
        </div>
        <PeriodSelect period={period} path="/estabelecimentos" />
      </div>

      {ranked.length === 0 ? (
        <div className="grid justify-items-start gap-2">
          <p className="text-muted-foreground">
            Nenhuma despesa com estabelecimento neste período.
          </p>
          <p className="text-sm text-muted-foreground">
            Ao registrar um gasto, diga onde foi em “O que foi?”: o lugar aparece aqui.
          </p>
          <Link href="/registrar" className="text-sm underline underline-offset-4">
            Registrar um gasto
          </Link>
        </div>
      ) : (
        <ol aria-label="Ranking" className="divide-y rounded-lg border">
          {shown.map((row, index) => (
            <li key={row.id}>
              <Link
                href={href(row.id)}
                className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-muted/50"
              >
                <span className="w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                {row.category ? (
                  <CategoryIcon
                    icon={row.category.icon}
                    color={row.category.color}
                    className="size-8"
                  />
                ) : (
                  <span aria-hidden className="size-8 shrink-0 rounded-lg bg-muted" />
                )}
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">{row.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {purchasesText(row.purchases)}
                    {row.category && ` · ${row.category.name}`}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{formatBRL(row.totalCents)}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ol>
      )}
      {!showAll && ranked.length > SHOWN && (
        <Button variant="ghost" className="h-10" onClick={() => setShowAll(true)}>
          Mostrar mais
        </Button>
      )}
    </div>
  );
}
