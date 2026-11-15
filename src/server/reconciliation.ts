import "server-only";

import { calendarDateToDb, todayInSaoPaulo } from "@/domain/dates";
import { ADJUSTMENT_DESCRIPTION, adjustmentFor, reconciliationDiff } from "@/domain/reconciliation";
import { TRANSACTION_DATE_MIN } from "@/domain/transactions";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { listTransactions } from "@/server/transaction-list";
import { accountBalances } from "@/server/transactions";

/** How many recent entries the reconcile dialog shows. */
export const RECENT_ENTRIES = 10;

export type ReconcileError = "NOT_FOUND" | "ACCOUNT_ARCHIVED";

export const RECONCILE_ERROR_MESSAGES: Record<ReconcileError, string> = {
  NOT_FOUND: "Conta não encontrada.",
  ACCOUNT_ARCHIVED: "Essa conta está arquivada.",
};

async function activeAccount(spaceId: string, accountId: string) {
  const account = await db.account.findFirst({
    where: { id: accountId, spaceId },
    select: { id: true, archivedAt: true },
  });
  if (!account) return { ok: false as const, error: "NOT_FOUND" as const };
  if (account.archivedAt) return { ok: false as const, error: "ACCOUNT_ARCHIVED" as const };
  return { ok: true as const };
}

/**
 * Compares the bank's balance with the app's (today's, as on the accounts screen), with the
 * account's latest entries to help remember what's missing. Writes nothing.
 */
export async function compareBalance(spaceId: string, accountId: string, bankBalanceCents: number) {
  const account = await activeAccount(spaceId, accountId);
  if (!account.ok) return account;
  const today = todayInSaoPaulo();
  const [balances, page] = await Promise.all([
    accountBalances(spaceId),
    // The account's entries up to today, transfers into it included.
    listTransactions(spaceId, { from: TRANSACTION_DATE_MIN, to: today, accountId }),
  ]);
  const appBalanceCents = balances.get(accountId) ?? 0;
  return {
    ok: true as const,
    appBalanceCents,
    bankBalanceCents,
    ...reconciliationDiff(appBalanceCents, bankBalanceCents),
    entries: page.items.slice(0, RECENT_ENTRIES),
  };
}

export type Comparison = Extract<Awaited<ReturnType<typeof compareBalance>>, { ok: true }>;

/**
 * Records a reconciliation. When the balances match, it marks the account as reconciled today.
 * With `adjust` and a difference, it creates the adjustment that closes it (idempotent by
 * `clientId`) and marks the account, in one database transaction. Without `adjust`, a difference
 * writes nothing. The app's balance is computed here, never taken from the screen.
 */
export async function reconcileAccount(
  spaceId: string,
  userId: string,
  accountId: string,
  bankBalanceCents: number,
  { adjust, clientId }: { adjust: boolean; clientId: string },
): Promise<
  | { ok: true; reconciled: boolean; diffCents: number; adjustmentId: string | null }
  | { ok: false; error: ReconcileError }
> {
  const account = await activeAccount(spaceId, accountId);
  if (!account.ok) return account;

  // A retry of an adjustment that already went through answers with it.
  const existing = await db.transaction.findUnique({
    where: { spaceId_clientId: { spaceId, clientId } },
    select: { id: true, adjustment: true, accountId: true },
  });
  if (existing?.adjustment && existing.accountId === accountId) {
    return { ok: true, reconciled: true, diffCents: 0, adjustmentId: existing.id };
  }

  const today = todayInSaoPaulo();
  const appBalanceCents = (await accountBalances(spaceId)).get(accountId) ?? 0;
  const { diffCents } = reconciliationDiff(appBalanceCents, bankBalanceCents);
  const adjustment = adjustmentFor(diffCents);
  if (adjustment && !adjust) return { ok: true, reconciled: false, diffCents, adjustmentId: null };

  const mark = {
    reconciledOn: calendarDateToDb(today),
    reconciledBalanceCents: bankBalanceCents,
  };
  try {
    const adjustmentId = await db.$transaction(async (tx) => {
      await tx.account.update({ where: { id: accountId }, data: mark });
      if (!adjustment) return null;
      const created = await tx.transaction.create({
        data: {
          spaceId,
          clientId,
          createdById: userId,
          type: adjustment.type,
          amountCents: adjustment.amountCents,
          date: calendarDateToDb(today),
          method: "PIX",
          accountId,
          description: ADJUSTMENT_DESCRIPTION,
          adjustment: true,
        },
        select: { id: true },
      });
      return created.id;
    });
    return { ok: true, reconciled: true, diffCents, adjustmentId };
  } catch (error) {
    // The same clientId at the same instant (a double tap): the other one went through.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await db.transaction.findUnique({
        where: { spaceId_clientId: { spaceId, clientId } },
        select: { id: true },
      });
      if (winner) return { ok: true, reconciled: true, diffCents: 0, adjustmentId: winner.id };
    }
    throw error;
  }
}
