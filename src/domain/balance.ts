/**
 * An account's balance. Pure functions only (no Prisma, no I/O).
 *
 * Balance = initial balance + the entries after it, up to `asOf`. "After" is any later day, or the
 * initial balance day itself when the entry was registered after the balance was informed (you
 * set the balance in the morning and register the lunch at noon). Entries of that day registered
 * earlier, and of earlier days, are already in the balance the bank showed.
 * - income: +
 * - expense by any method but credit: −  (a credit purchase is paid through the invoice)
 * - invoice payment: − on the paying account
 * - transfer: − on the origin, + on the destination
 */
import type { CalendarDate } from "./dates";
import type { PaymentMethod, TransactionType } from "./transactions";

export type BalanceAccount = {
  id: string;
  initialBalanceCents: number;
  initialBalanceDate: CalendarDate;
  /** When the initial balance (amount or day) was last informed. */
  initialBalanceSetAt: Date;
};

export type BalanceEntry = {
  type: TransactionType;
  method: PaymentMethod;
  amountCents: number;
  date: CalendarDate;
  accountId: string | null;
  toAccountId: string | null;
  createdAt: Date;
};

/** How much `entry` moves account `accountId`, in cents (0 when it doesn't touch it). */
export function balanceEffect(entry: BalanceEntry, accountId: string): number {
  switch (entry.type) {
    case "INCOME":
      return entry.accountId === accountId ? entry.amountCents : 0;
    case "EXPENSE":
      return entry.accountId === accountId && entry.method !== "CREDIT" ? -entry.amountCents : 0;
    case "CARD_PAYMENT":
      return entry.accountId === accountId ? -entry.amountCents : 0;
    case "TRANSFER":
      return (
        (entry.toAccountId === accountId ? entry.amountCents : 0) -
        (entry.accountId === accountId ? entry.amountCents : 0)
      );
  }
}

function isAfterInitialBalance(entry: BalanceEntry, account: BalanceAccount) {
  if (entry.date !== account.initialBalanceDate) return entry.date > account.initialBalanceDate;
  return entry.createdAt.getTime() > account.initialBalanceSetAt.getTime();
}

/** The balance of `account` at the end of `asOf`. */
export function accountBalance(
  account: BalanceAccount,
  entries: readonly BalanceEntry[],
  asOf: CalendarDate,
): number {
  let balance = account.initialBalanceCents;
  for (const entry of entries) {
    // "YYYY-MM-DD" strings compare in calendar order.
    if (entry.date > asOf || !isAfterInitialBalance(entry, account)) continue;
    balance += balanceEffect(entry, account.id);
  }
  return balance;
}
