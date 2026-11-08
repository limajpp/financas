/**
 * Spending and income sums. The one rule kept here: transfers and invoice payments move money
 * between your own places, so they are never spending or income. Credit purchases are spending
 * on the purchase date (design). The dashboard metrics (task 23) build on these.
 */
import type { TransactionType } from "./transactions";

export type TotalsEntry = { type: TransactionType; amountCents: number; categoryId: string | null };

function sumByCategory(entries: readonly TotalsEntry[], type: "EXPENSE" | "INCOME") {
  const totals = new Map<string | null, number>();
  for (const entry of entries) {
    if (entry.type !== type) continue;
    totals.set(entry.categoryId, (totals.get(entry.categoryId) ?? 0) + entry.amountCents);
  }
  return totals;
}

/** Expenses per category (null: uncategorized), in cents. */
export function spendingByCategory(entries: readonly TotalsEntry[]): Map<string | null, number> {
  return sumByCategory(entries, "EXPENSE");
}

/** Income per category (null: uncategorized), in cents. */
export function incomeByCategory(entries: readonly TotalsEntry[]): Map<string | null, number> {
  return sumByCategory(entries, "INCOME");
}
