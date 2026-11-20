/**
 * The plain part of the transactions list's filters (task 14): the type, the URL names and the
 * helpers. No zod here: client components import it, and the schema stays on the server side
 * (src/lib/validation/transaction-filters.ts), out of the phone's JavaScript (task 26).
 */
import type { CalendarDate } from "@/domain/dates";
import type { PAYMENT_METHODS, TRANSACTION_TYPES } from "@/domain/transactions";

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

/** The month of `date`: its first and last days. */
export function monthRange(date: CalendarDate): { from: CalendarDate; to: CalendarDate } {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const month = date.slice(0, 7);
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
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
