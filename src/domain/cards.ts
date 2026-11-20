/**
 * Credit-card rules. Pure functions only (no Prisma, no I/O).
 */
import type { CalendarDate } from "./dates";
import { CYCLE_EPOCH, type CycleVersion, type InvoiceCycle } from "./invoice-cycle";
import { normalizeName } from "./names";

export const CARD_NAME_MAX = 40;

export type CardNode = { id: string; name: string };
export type PaymentAccount = { id: string; archivedAt: Date | null };

export type CardError = "DUPLICATE_NAME" | "ACCOUNT_NOT_FOUND" | "ACCOUNT_ARCHIVED";

export const CARD_ERROR_MESSAGES: Record<CardError | "NOT_FOUND", string> = {
  NOT_FOUND: "Cartão não encontrado.",
  DUPLICATE_NAME: "Já existe um cartão com esse nome.",
  ACCOUNT_NOT_FOUND: "Conta não encontrada.",
  ACCOUNT_ARCHIVED: "Essa conta está arquivada. Escolha outra.",
};

export type CardRuleResult = { ok: true } | { ok: false; error: CardError };

/**
 * Checks a new or edited card (`id` and `currentAccountId` set when editing) against the space's
 * cards and accounts. An edited card may keep an account archived after it was chosen.
 */
export function validateCard(
  input: { id?: string; name: string; accountId: string; currentAccountId?: string },
  cards: readonly CardNode[],
  accounts: readonly PaymentAccount[],
): CardRuleResult {
  const key = normalizeName(input.name);
  if (cards.some((c) => c.id !== input.id && normalizeName(c.name) === key)) {
    return { ok: false, error: "DUPLICATE_NAME" };
  }
  const account = accounts.find((a) => a.id === input.accountId);
  if (!account) return { ok: false, error: "ACCOUNT_NOT_FOUND" };
  if (account.archivedAt !== null && account.id !== input.currentAccountId) {
    return { ok: false, error: "ACCOUNT_ARCHIVED" };
  }
  return { ok: true };
}

/**
 * The cycle version to write when a card's days are edited, or null when they didn't change.
 * Normally it starts today (a version already starting today is replaced: same validFrom).
 * On the day the card was created, an edit is a correction: it rewrites the first version, so
 * back-dated purchases don't keep the mistyped days.
 */
export function cycleChange(
  current: InvoiceCycle,
  next: InvoiceCycle,
  today: CalendarDate,
  { createdToday = false } = {},
): CycleVersion | null {
  if (current.closingDay === next.closingDay && current.dueDay === next.dueDay) return null;
  return { ...next, validFrom: createdToday ? CYCLE_EPOCH : today };
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

export function sortCards<T extends CardNode>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => collator.compare(a.name, b.name));
}
