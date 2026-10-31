import "server-only";

import { type BalanceEntry, accountBalance } from "@/domain/balance";
import { calendarDateToDb, dbToCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { normalizeName } from "@/domain/names";
import {
  type CurrentRefs,
  type EntryInput,
  type EntryRefs,
  type TransactionError,
  validateEntry,
} from "@/domain/transactions";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

const transactionSelect = {
  id: true,
  clientId: true,
  type: true,
  amountCents: true,
  date: true,
  method: true,
  accountId: true,
  toAccountId: true,
  cardId: true,
  invoiceDueDate: true,
  invoiceOverridden: true,
  categoryId: true,
  description: true,
  counterparty: { select: { id: true, name: true } },
} as const;

type TransactionDbRow = Prisma.TransactionGetPayload<{ select: typeof transactionSelect }>;

function toTransaction(row: TransactionDbRow) {
  return {
    ...row,
    date: dbToCalendarDate(row.date),
    invoiceDueDate: row.invoiceDueDate && dbToCalendarDate(row.invoiceDueDate),
  };
}

export type TransactionRow = ReturnType<typeof toTransaction>;

export type TransactionResult =
  | { ok: true; transaction: TransactionRow }
  | { ok: false; error: TransactionError | "NOT_FOUND" | "NOT_EDITABLE" };

export type CreateTransactionResult =
  | { ok: true; transaction: TransactionRow; created: boolean }
  | { ok: false; error: TransactionError };

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** The account, card and category the entry names, looked up in the space only. */
async function refsFor(spaceId: string, input: EntryInput): Promise<EntryRefs> {
  const [accounts, cards, categories] = await Promise.all([
    input.accountId
      ? db.account.findMany({
          where: { id: input.accountId, spaceId },
          select: { id: true, archivedAt: true },
        })
      : [],
    input.cardId
      ? db.card.findMany({
          where: { id: input.cardId, spaceId },
          select: {
            id: true,
            archivedAt: true,
            cycles: { select: { closingDay: true, dueDay: true, validFrom: true } },
          },
        })
      : [],
    input.categoryId
      ? db.category.findMany({
          where: { id: input.categoryId, spaceId },
          select: {
            id: true,
            type: true,
            archivedAt: true,
            parent: { select: { archivedAt: true } },
          },
        })
      : [],
  ]);
  return {
    accounts,
    cards: cards.map((card) => ({
      ...card,
      cycles: card.cycles.map((c) => ({ ...c, validFrom: dbToCalendarDate(c.validFrom) })),
    })),
    categories,
  };
}

/**
 * The counterparty with this name in the space (compared without case and accents), created if
 * missing. By name, not id: an entry made offline may name one the server doesn't know yet.
 */
async function counterpartyIdFor(spaceId: string, name: string | null) {
  if (name === null) return null;
  const nameKey = normalizeName(name);
  const where = { spaceId_nameKey: { spaceId, nameKey } };
  const existing = await db.counterparty.findUnique({ where, select: { id: true } });
  if (existing) return existing.id;
  try {
    const created = await db.counterparty.create({
      data: { spaceId, name, nameKey },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // Created at the same time by another request.
    if (isUniqueViolation(error)) {
      return (await db.counterparty.findUniqueOrThrow({ where, select: { id: true } })).id;
    }
    throw error;
  }
}

function entryData(
  input: EntryInput,
  invoice: { invoiceDueDate: string; invoiceOverridden: boolean } | null,
) {
  return {
    type: input.type,
    amountCents: input.amountCents,
    date: calendarDateToDb(input.date),
    method: input.method,
    accountId: input.accountId,
    cardId: input.cardId,
    toAccountId: null,
    invoiceDueDate: invoice ? calendarDateToDb(invoice.invoiceDueDate) : null,
    invoiceOverridden: invoice?.invoiceOverridden ?? false,
    categoryId: input.categoryId,
    description: input.description,
  };
}

async function findByClientId(spaceId: string, clientId: string) {
  const row = await db.transaction.findUnique({
    where: { spaceId_clientId: { spaceId, clientId } },
    select: transactionSelect,
  });
  return row && toTransaction(row);
}

/**
 * Creates an expense or income. Idempotent by `clientId`: if the space already has it, returns
 * that one unchanged (`created: false`), including when two calls race.
 */
export async function createTransaction(
  spaceId: string,
  userId: string,
  clientId: string,
  input: EntryInput,
): Promise<CreateTransactionResult> {
  const existing = await findByClientId(spaceId, clientId);
  if (existing) return { ok: true, transaction: existing, created: false };

  const checked = validateEntry(input, await refsFor(spaceId, input), {
    today: todayInSaoPaulo(),
  });
  if (!checked.ok) return checked;

  try {
    const row = await db.transaction.create({
      data: {
        spaceId,
        clientId,
        createdById: userId,
        counterpartyId: await counterpartyIdFor(spaceId, input.counterparty),
        ...entryData(input, checked.invoice),
      },
      select: transactionSelect,
    });
    return { ok: true, transaction: toTransaction(row), created: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await findByClientId(spaceId, clientId);
      if (winner) return { ok: true, transaction: winner, created: false };
    }
    throw error;
  }
}

/**
 * Edits an expense or income: everything but `clientId` and the author. A credit purchase's
 * invoice is recomputed unless the input brings a manual choice again.
 */
export async function updateTransaction(
  spaceId: string,
  id: string,
  input: EntryInput,
): Promise<TransactionResult> {
  const current = await db.transaction.findFirst({
    where: { id, spaceId },
    select: { type: true, accountId: true, cardId: true, categoryId: true },
  });
  if (!current) return { ok: false, error: "NOT_FOUND" };
  if (current.type !== "EXPENSE" && current.type !== "INCOME") {
    return { ok: false, error: "NOT_EDITABLE" };
  }

  const refs: CurrentRefs = current;
  const checked = validateEntry(input, await refsFor(spaceId, input), {
    today: todayInSaoPaulo(),
    current: refs,
  });
  if (!checked.ok) return checked;

  const row = await db.transaction.update({
    where: { id, spaceId },
    data: {
      counterpartyId: await counterpartyIdFor(spaceId, input.counterparty),
      ...entryData(input, checked.invoice),
    },
    select: transactionSelect,
  });
  return { ok: true, transaction: toTransaction(row) };
}

export async function deleteTransaction(
  spaceId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" }> {
  const { count } = await db.transaction.deleteMany({ where: { id, spaceId } });
  return count === 1 ? { ok: true } : { ok: false, error: "NOT_FOUND" };
}

/** Today's balance (end of day in São Paulo) of every account in the space, by account id. */
export async function accountBalances(spaceId: string): Promise<Map<string, number>> {
  const today = todayInSaoPaulo();
  const [accounts, rows] = await Promise.all([
    db.account.findMany({
      where: { spaceId },
      select: { id: true, initialBalanceCents: true, initialBalanceDate: true },
    }),
    // Only what can move an account: credit purchases point to a card instead.
    db.transaction.findMany({
      where: {
        spaceId,
        date: { lte: calendarDateToDb(today) },
        OR: [{ accountId: { not: null } }, { toAccountId: { not: null } }],
      },
      select: {
        type: true,
        method: true,
        amountCents: true,
        date: true,
        accountId: true,
        toAccountId: true,
      },
    }),
  ]);
  const entries: BalanceEntry[] = rows.map((r) => ({ ...r, date: dbToCalendarDate(r.date) }));
  return new Map(
    accounts.map((account) => [
      account.id,
      accountBalance(
        { ...account, initialBalanceDate: dbToCalendarDate(account.initialBalanceDate) },
        entries,
        today,
      ),
    ]),
  );
}
