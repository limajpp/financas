/**
 * Reconciling an account with the bank: the difference and the adjustment that closes it. Pure
 * functions only. Spec: docs/specs/tasks/21-reconcile-balance.md.
 */

export type ReconciliationDirection = "MISSING_EXPENSE" | "MISSING_INCOME" | "MATCH";

/**
 * The bank's balance minus the app's. Below zero the bank has less (an expense is missing);
 * above zero it has more (an income is missing).
 */
export function reconciliationDiff(
  appBalanceCents: number,
  bankBalanceCents: number,
): { diffCents: number; direction: ReconciliationDirection } {
  const diffCents = bankBalanceCents - appBalanceCents;
  return {
    diffCents,
    direction: diffCents < 0 ? "MISSING_EXPENSE" : diffCents > 0 ? "MISSING_INCOME" : "MATCH",
  };
}

/** The entry that closes a difference: an expense or income of its size; none when it matches. */
export function adjustmentFor(
  diffCents: number,
): { type: "EXPENSE" | "INCOME"; amountCents: number } | null {
  if (diffCents === 0) return null;
  return { type: diffCents < 0 ? "EXPENSE" : "INCOME", amountCents: Math.abs(diffCents) };
}

/** The note every adjustment gets. */
export const ADJUSTMENT_DESCRIPTION = "Ajuste da conferência de saldo";
