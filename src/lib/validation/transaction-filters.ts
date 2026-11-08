import { z } from "zod";

import { type CalendarDate, isCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { PAYMENT_METHODS, TRANSACTION_TYPES } from "@/domain/transactions";

/**
 * The transactions list's filters, as they travel in the URL (docs/specs/tasks/14-transactions-list.md).
 * An invalid value is dropped, never an error: a stale or hand-edited link still opens.
 */
export type TransactionFilters = {
  from: CalendarDate;
  to: CalendarDate;
  accountId?: string;
  cardId?: string;
  method?: (typeof PAYMENT_METHODS)[number];
  /** A category id (a parent includes its children), or "none" for uncategorized. */
  categoryId?: string;
  counterpartyId?: string;
  type?: (typeof TRANSACTION_TYPES)[number];
  q?: string;
};

/** The URL parameter of each filter. */
export const FILTER_PARAMS = {
  from: "de",
  to: "ate",
  accountId: "conta",
  cardId: "cartao",
  method: "forma",
  categoryId: "categoria",
  counterpartyId: "estabelecimento",
  type: "tipo",
  q: "q",
} as const satisfies Record<keyof TransactionFilters, string>;

export const SEARCH_MAX = 60;

const date = z.string().refine(isCalendarDate).optional().catch(undefined);
const id = z.uuid().optional().catch(undefined);

const schema = z.object({
  de: date,
  ate: date,
  conta: id,
  cartao: id,
  forma: z.enum(PAYMENT_METHODS).optional().catch(undefined),
  categoria: z
    .union([z.uuid(), z.literal("none")])
    .optional()
    .catch(undefined),
  estabelecimento: id,
  tipo: z.enum(TRANSACTION_TYPES).optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(SEARCH_MAX)
    .optional()
    .catch(undefined)
    .transform((v) => (v ? v : undefined)),
});

/** The month of `date`: its first and last days. */
export function monthRange(date: CalendarDate): { from: CalendarDate; to: CalendarDate } {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const month = date.slice(0, 7);
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Filters from the URL's search params; the period defaults to the current month. */
export function parseFilters(
  params: Record<string, string | string[] | undefined>,
  today: CalendarDate = todayInSaoPaulo(),
): TransactionFilters {
  const single = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const parsed = schema.parse(single);
  const month = monthRange(today);
  let from = parsed.de ?? month.from;
  let to = parsed.ate ?? (parsed.de ? monthRange(parsed.de).to : month.to);
  if (from > to) [from, to] = [to, from];
  return {
    from,
    to,
    accountId: parsed.conta,
    cardId: parsed.cartao,
    method: parsed.forma,
    categoryId: parsed.categoria,
    counterpartyId: parsed.estabelecimento,
    type: parsed.tipo,
    q: parsed.q,
  };
}

/** Filters back to search params (the defaults of the period are kept explicit). */
export function filtersToParams(filters: TransactionFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, param] of Object.entries(FILTER_PARAMS) as [
    keyof TransactionFilters,
    string,
  ][]) {
    const value = filters[key];
    if (value) params.set(param, value);
  }
  return params;
}

/** How many filters (besides the period) are on. */
export function activeFilterCount(filters: TransactionFilters): number {
  return (
    ["accountId", "cardId", "method", "categoryId", "counterpartyId", "type"] as const
  ).filter((k) => filters[k] !== undefined).length;
}
