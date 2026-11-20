import "server-only";

import {
  type CalendarDate,
  calendarDateToDb,
  dbToCalendarDate,
  todayInSaoPaulo,
} from "@/domain/dates";
import { ADJUSTMENT_DESCRIPTION, adjustmentFor, reconciliationDiff } from "@/domain/reconciliation";
import { MAX_AMOUNT_CENTS } from "@/domain/money";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { generateRecurringSafely } from "@/server/recurring";
import { listTransactions } from "@/server/transaction-list";
import { accountBalances } from "@/server/transactions";

/** How many recent entries the reconcile dialog shows. */
export const RECENT_ENTRIES = 10;

export type ReconcileError = "NOT_FOUND" | "ACCOUNT_ARCHIVED" | "TOO_LARGE";

export const RECONCILE_ERROR_MESSAGES: Record<ReconcileError, string> = {
  NOT_FOUND: "Conta não encontrada.",
  ACCOUNT_ARCHIVED: "Essa conta está arquivada.",
  TOO_LARGE: "A diferença passa de R$ 20.000.000,00. Confira o saldo digitado.",
};

async function activeAccount(spaceId: string, accountId: string) {
  const account = await db.account.findFirst({
    where: { id: accountId, spaceId },
    select: { id: true, archivedAt: true, initialBalanceDate: true },
  });
  if (!account) return { ok: false as const, error: "NOT_FOUND" as const };
  if (account.archivedAt) return { ok: false as const, error: "ACCOUNT_ARCHIVED" as const };
  return { ok: true as const, initialBalanceDate: dbToCalendarDate(account.initialBalanceDate) };
}

/**
 * The account's latest entries up to today that move it (from its initial balance's day on),
 * transfers into it included: what the reconcile dialog shows to help remember.
 */
export async function accountRecentEntries(spaceId: string, accountId: string, from: CalendarDate) {
  const page = await listTransactions(spaceId, { from, to: todayInSaoPaulo(), accountId });
  return page.items.slice(0, RECENT_ENTRIES);
}

/**
 * Compares the bank's balance with the app's (today's, as on the accounts screen), with the
 * account's latest entries to help remember what's missing. Writes nothing.
 */
export async function compareBalance(spaceId: string, accountId: string, bankBalanceCents: number) {
  const account = await activeAccount(spaceId, accountId);
  if (!account.ok) return account;
  // Today's subscription charges first, so the balance has them (task 13).
  await generateRecurringSafely(spaceId);
  const [balances, entries] = await Promise.all([
    accountBalances(spaceId),
    accountRecentEntries(spaceId, accountId, account.initialBalanceDate),
  ]);
  const appBalanceCents = balances.get(accountId) ?? 0;
  return {
    ok: true as const,
    appBalanceCents,
    bankBalanceCents,
    ...reconciliationDiff(appBalanceCents, bankBalanceCents),
    entries,
  };
}

export type Comparison = Extract<Awaited<ReturnType<typeof compareBalance>>, { ok: true }>;

class TooLarge extends Error {}

class Changed extends Error {
  constructor(readonly appBalanceCents: number) {
    super("changed");
  }
}

/**
 * Records a reconciliation, for the difference the screen showed (`expectedDiffCents`). The
 * account is locked and its balance computed again inside the database transaction: if the
 * difference isn't the one shown anymore (an entry came in, another device reconciled), nothing
 * is written and the new app balance comes back. Otherwise a match marks the account as
 * reconciled today, and with `adjust` a difference becomes the adjustment that closes it
 * (idempotent by `clientId`), together with the mark.
 */
export async function reconcileAccount(
  spaceId: string,
  userId: string,
  accountId: string,
  bankBalanceCents: number,
  {
    adjust,
    clientId,
    expectedDiffCents,
  }: { adjust: boolean; clientId: string; expectedDiffCents: number },
): Promise<
  | { ok: true; reconciled: true; adjustment: { id: string; amountCents: number } | null }
  | { ok: true; reconciled: false; appBalanceCents: number }
  | { ok: false; error: ReconcileError }
> {
  const account = await activeAccount(spaceId, accountId);
  if (!account.ok) return account;

  // A retry of an adjustment that already went through answers with it.
  const done = await existingAdjustment(spaceId, clientId, accountId);
  if (done) return { ok: true, reconciled: true, adjustment: done };

  await generateRecurringSafely(spaceId);
  const today = todayInSaoPaulo();
  try {
    const adjustment = await db.$transaction(async (tx) => {
      // New entries on the account (their foreign key needs the row), a change of its initial
      // balance and another reconciliation wait for this lock. Editing or deleting an entry
      // doesn't, which is the same as it happening right after: the balance below reads what is
      // committed, after the lock.
      await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} FOR UPDATE`;
      // A retry whose first try went through while this one waited: that adjustment is the answer.
      const earlier = await tx.transaction.findUnique({
        where: { spaceId_clientId: { spaceId, clientId } },
        select: { id: true, amountCents: true, adjustment: true, accountId: true },
      });
      if (earlier?.adjustment && earlier.accountId === accountId) {
        return { id: earlier.id, amountCents: earlier.amountCents };
      }
      const appBalanceCents = (await accountBalances(spaceId, tx)).get(accountId) ?? 0;
      const { diffCents } = reconciliationDiff(appBalanceCents, bankBalanceCents);
      if (diffCents !== expectedDiffCents) throw new Changed(appBalanceCents);
      const closing = adjustmentFor(diffCents);
      if (closing && !adjust) throw new Changed(appBalanceCents);
      if (closing && closing.amountCents > MAX_AMOUNT_CENTS) throw new TooLarge();
      await tx.account.update({
        where: { id: accountId },
        data: {
          reconciledOn: calendarDateToDb(today),
          reconciledBalanceCents: bankBalanceCents,
        },
      });
      if (!closing) return null;
      const created = await tx.transaction.create({
        data: {
          spaceId,
          clientId,
          createdById: userId,
          type: closing.type,
          amountCents: closing.amountCents,
          date: calendarDateToDb(today),
          method: "PIX",
          accountId,
          description: ADJUSTMENT_DESCRIPTION,
          adjustment: true,
        },
        select: { id: true, amountCents: true },
      });
      return created;
    });
    return { ok: true, reconciled: true, adjustment };
  } catch (error) {
    if (error instanceof TooLarge) return { ok: false, error: "TOO_LARGE" };
    if (error instanceof Changed) {
      return { ok: true, reconciled: false, appBalanceCents: error.appBalanceCents };
    }
    // The same clientId at the same instant (a double tap): the other one went through.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await existingAdjustment(spaceId, clientId, accountId);
      if (winner) return { ok: true, reconciled: true, adjustment: winner };
    }
    throw error;
  }
}

/** The adjustment of this account created with `clientId`, if any (never another entry). */
async function existingAdjustment(spaceId: string, clientId: string, accountId: string) {
  const row = await db.transaction.findUnique({
    where: { spaceId_clientId: { spaceId, clientId } },
    select: { id: true, amountCents: true, adjustment: true, accountId: true },
  });
  return row?.adjustment && row.accountId === accountId
    ? { id: row.id, amountCents: row.amountCents }
    : null;
}
