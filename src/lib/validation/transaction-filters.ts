import { z } from "zod";

import { type CalendarDate, isCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { PAYMENT_METHODS, TRANSACTION_TYPES } from "@/domain/transactions";
import {
  FILTER_PARAMS,
  SEARCH_MAX,
  type TransactionFilters,
  activeFilterCount,
  filtersToParams,
  monthRange,
} from "@/lib/transaction-filter-params";

// The plain part lives apart, zod-free, for the client components (task 26).
export {
  FILTER_PARAMS,
  SEARCH_MAX,
  type TransactionFilters,
  activeFilterCount,
  filtersToParams,
  monthRange,
};

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

/**
 * Filters from the URL's search params; the period defaults to the current month. An invalid value
 * is dropped, never an error: a stale or hand-edited link still opens.
 */
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
