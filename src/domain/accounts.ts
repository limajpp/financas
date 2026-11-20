/**
 * Bank account rules. Pure functions only (no Prisma, no I/O).
 */
import type { CalendarDate } from "./dates";
import { normalizeName } from "./names";

export const ACCOUNT_NAME_MAX = 40;

export type AccountNode = {
  id: string;
  name: string;
  archivedAt: Date | null;
};

export type AccountError = "DUPLICATE_NAME" | "FUTURE_DATE";

export const ACCOUNT_ERROR_MESSAGES: Record<AccountError | "NOT_FOUND", string> = {
  NOT_FOUND: "Conta não encontrada.",
  DUPLICATE_NAME: "Já existe uma conta com esse nome.",
  FUTURE_DATE: "A data do saldo inicial não pode estar no futuro.",
};

export type AccountRuleResult = { ok: true } | { ok: false; error: AccountError };

/**
 * Checks a new or edited account (`id` set when editing) against the space's accounts.
 * Archived accounts keep their names taken. `today` is today in São Paulo.
 */
export function validateAccount(
  input: { id?: string; name: string; initialBalanceDate: CalendarDate },
  existing: readonly AccountNode[],
  today: CalendarDate,
): AccountRuleResult {
  const key = normalizeName(input.name);
  if (existing.some((a) => a.id !== input.id && normalizeName(a.name) === key)) {
    return { ok: false, error: "DUPLICATE_NAME" };
  }
  // "YYYY-MM-DD" strings compare in calendar order.
  if (input.initialBalanceDate > today) return { ok: false, error: "FUTURE_DATE" };
  return { ok: true };
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** Accounts in pt-BR alphabetical order. */
export function sortAccounts<T extends AccountNode>(accounts: readonly T[]): T[] {
  return [...accounts].sort((a, b) => collator.compare(a.name, b.name));
}

/** What an account picker offers: nothing archived. */
export function selectableAccountList<T extends AccountNode>(accounts: readonly T[]): T[] {
  return sortAccounts(accounts.filter((a) => a.archivedAt === null));
}
