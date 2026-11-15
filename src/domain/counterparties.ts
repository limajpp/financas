/**
 * The counterparties screen: periods, the ranking, the average ticket and merging two
 * counterparties' memory. Pure functions only. Spec: docs/specs/tasks/20-counterparties.md.
 */
import { addAlias } from "./counterparty-memory";
import type { CalendarDate } from "./dates";
import { normalizeName } from "./names";

export const PERIODS = ["mes", "mes-passado", "3-meses", "ano"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  mes: "Este mês",
  "mes-passado": "Mês passado",
  "3-meses": "Últimos 3 meses",
  ano: "Este ano",
};

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value);
}

/** The first and last day of the month `offset` months from `date`'s. */
function monthBounds(date: CalendarDate, offset: number) {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1 + offset, 1));
  const last = new Date(Date.UTC(y, m + offset, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** The days a period covers: whole months, or the whole year. */
export function periodRange(period: Period, today: CalendarDate) {
  switch (period) {
    case "mes":
      return monthBounds(today, 0);
    case "mes-passado":
      return monthBounds(today, -1);
    case "3-meses":
      return { from: monthBounds(today, -2).from, to: monthBounds(today, 0).to };
    case "ano":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  }
}

export type RankingOrder = "value" | "frequency";

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/**
 * By value: the biggest total first, then the most purchases. By frequency: the most purchases
 * first, then the biggest total. Then the name.
 */
export function rankCounterparties<
  T extends { name: string; totalCents: number; purchases: number },
>(rows: readonly T[], order: RankingOrder): T[] {
  return [...rows].sort((a, b) => {
    const byValue = b.totalCents - a.totalCents;
    const byCount = b.purchases - a.purchases;
    const first = order === "value" ? byValue || byCount : byCount || byValue;
    return first || collator.compare(a.name, b.name);
  });
}

/** The total over the purchases, rounded to the cent; null without purchases. */
export function averageTicket(totalCents: number, purchases: number): number | null {
  return purchases > 0 ? Math.round(totalCents / purchases) : null;
}

/** The aliases to keep: no blanks, no repeats, not the name itself (without case and accents). */
export function cleanAliases(name: string, aliases: readonly string[]): string[] {
  const nameKey = normalizeName(name);
  const kept: string[] = [];
  for (const raw of aliases) {
    const alias = raw.trim();
    const key = normalizeName(alias);
    if (key === "" || key === nameKey || kept.some((k) => normalizeName(k) === key)) continue;
    kept.push(alias);
  }
  return kept;
}

type Memory = {
  name: string;
  aliases: readonly string[];
  document: string | null;
  defaultCategoryId: string | null;
  defaultDescription: string | null;
};

/**
 * The memory of the counterparty that stays after absorbing another: its aliases, then the
 * absorbed one's aliases and name (at most 10, the oldest go first, as in addAlias); its document
 * and defaults, or the absorbed one's when it has none. `documentDropped` is the absorbed
 * document lost because the kept one had a different one.
 */
export function mergeMemory(keep: Memory, absorbed: Memory) {
  const keepKey = normalizeName(keep.name);
  let aliases = [...keep.aliases];
  for (const alias of [...absorbed.aliases, absorbed.name]) {
    if (normalizeName(alias) === keepKey) continue;
    aliases = addAlias(aliases, alias);
  }
  return {
    aliases,
    document: keep.document ?? absorbed.document,
    defaultCategoryId: keep.defaultCategoryId ?? absorbed.defaultCategoryId,
    defaultDescription: keep.defaultDescription ?? absorbed.defaultDescription,
    documentDropped:
      keep.document !== null && absorbed.document !== null && keep.document !== absorbed.document
        ? absorbed.document
        : null,
  };
}
