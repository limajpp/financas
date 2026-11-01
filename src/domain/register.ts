/**
 * Defaults of the register screen: the category buttons and the payment that comes selected.
 * Pure functions only. Spec: docs/specs/tasks/09-register.md.
 */
import { normalizeName } from "./names";
import { type EntryType, METHODS_BY_TYPE, type PaymentMethod } from "./transactions";

export const TOP_CATEGORIES = 5;
/** How far back the category usage goes, so the buttons follow changes in habits. */
export const USAGE_WINDOW_DAYS = 90;

export type CategoryUsage = { categoryId: string; count: number; lastUsedAt: Date };

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/**
 * The `n` category buttons: the most used selectable categories (ties: most recent), filled with
 * the parents in the default list's order (then alphabetically) when there isn't enough usage.
 * `categories` are the selectable ones of one type; usage of anything else is ignored.
 */
export function topCategories<T extends { id: string; parentId: string | null; name: string }>(
  usage: readonly CategoryUsage[],
  categories: readonly T[],
  defaultOrder: readonly string[],
  n = TOP_CATEGORIES,
): T[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const used = usage
    .filter((u) => byId.has(u.categoryId) && u.count > 0)
    .sort((a, b) => b.count - a.count || b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
    .map((u) => byId.get(u.categoryId)!);

  const position = new Map(defaultOrder.map((name, i) => [normalizeName(name), i]));
  const rank = (c: T) => position.get(normalizeName(c.name)) ?? Infinity;
  const fill = categories
    .filter((c) => c.parentId === null && !used.includes(c))
    .sort((a, b) => rank(a) - rank(b) || collator.compare(a.name, b.name));

  return [...used, ...fill].slice(0, n);
}

/**
 * What the last entries of a type used: the method of the last one, the last account used
 * without credit and the last card.
 */
export type PaymentMemory = {
  method: PaymentMethod | null;
  accountId: string | null;
  cardId: string | null;
};

export type PaymentChoice = { method: PaymentMethod; accountId: string; cardId: string | null };

/**
 * The payment the screen starts with: the remembered one while its account and card are still
 * active, else the first active ones (sorted by the caller); Pix when the remembered method
 * doesn't fit. Null when there's no active account.
 */
export function defaultPayment(
  type: EntryType,
  memory: PaymentMemory,
  accounts: readonly { id: string }[],
  cards: readonly { id: string }[],
): PaymentChoice | null {
  const account = accounts.find((a) => a.id === memory.accountId) ?? accounts[0];
  if (!account) return null;
  const card = cards.find((c) => c.id === memory.cardId) ?? cards[0];
  const fits =
    memory.method !== null &&
    METHODS_BY_TYPE[type].includes(memory.method) &&
    (memory.method !== "CREDIT" || card !== undefined);
  return {
    method: fits ? memory.method! : "PIX",
    accountId: account.id,
    cardId: card?.id ?? null,
  };
}
