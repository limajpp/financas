import "server-only";

import { calendarDateToDb, dbToCalendarDate } from "@/domain/dates";
import { parseBRL } from "@/domain/money";
import { normalizeName } from "@/domain/names";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { TransactionFilters } from "@/lib/validation/transaction-filters";

/** How many entries a page brings. */
export const PAGE_SIZE = 50;

/** Where a page ends: the last entry's date, registration time and id (the list's order). */
export type ListCursor = { date: string; createdAt: string; id: string };

const listSelect = {
  id: true,
  type: true,
  amountCents: true,
  date: true,
  createdAt: true,
  method: true,
  description: true,
  invoiceDueDate: true,
  invoiceOverridden: true,
  installmentGroupId: true,
  installmentNumber: true,
  installmentTotal: true,
  recurringRuleId: true,
  account: { select: { id: true, name: true } },
  toAccount: { select: { id: true, name: true } },
  card: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, icon: true, color: true, type: true } },
  counterparty: { select: { id: true, name: true } },
  recurringRule: { select: { dayOfMonth: true, amountCents: true, status: true } },
} as const satisfies Prisma.TransactionSelect;

/** The filters as a Prisma where, always inside the space. */
async function whereFor(spaceId: string, filters: TransactionFilters) {
  const and: Prisma.TransactionWhereInput[] = [
    { spaceId },
    { date: { gte: calendarDateToDb(filters.from), lte: calendarDateToDb(filters.to) } },
  ];
  if (filters.accountId) {
    // An account's entries include the transfers that come into it.
    and.push({ OR: [{ accountId: filters.accountId }, { toAccountId: filters.accountId }] });
  }
  if (filters.cardId) and.push({ cardId: filters.cardId });
  if (filters.method) and.push({ method: filters.method });
  if (filters.type) and.push({ type: filters.type });
  if (filters.counterpartyId) and.push({ counterpartyId: filters.counterpartyId });
  if (filters.categoryId === "none") {
    and.push({ categoryId: null, type: { in: ["EXPENSE", "INCOME"] } });
  } else if (filters.categoryId) {
    // A parent includes its children.
    and.push({
      OR: [{ categoryId: filters.categoryId }, { category: { parentId: filters.categoryId } }],
    });
  }
  if (filters.q) and.push(await searchWhere(spaceId, filters.q));
  return { AND: and } satisfies Prisma.TransactionWhereInput;
}

/**
 * The search: the description (case-insensitive), the counterparty's name and aliases (without
 * accents or case, compared in memory: a person has hundreds of counterparties) and, when the
 * query reads as an amount, that exact amount.
 */
async function searchWhere(spaceId: string, q: string): Promise<Prisma.TransactionWhereInput> {
  const key = normalizeName(q);
  const counterparties = await db.counterparty.findMany({
    where: { spaceId },
    select: { id: true, nameKey: true, aliases: true },
  });
  const matching = counterparties
    .filter((c) => c.nameKey.includes(key) || c.aliases.some((a) => normalizeName(a).includes(key)))
    .map((c) => c.id);
  const cents = parseBRL(q);
  return {
    OR: [
      { description: { contains: q, mode: "insensitive" } },
      ...(matching.length > 0 ? [{ counterpartyId: { in: matching } }] : []),
      ...(cents !== null && cents > 0 ? [{ amountCents: cents }] : []),
    ],
  };
}

function afterCursor(cursor: ListCursor): Prisma.TransactionWhereInput {
  const date = calendarDateToDb(cursor.date);
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { date: { lt: date } },
      { date, createdAt: { lt: createdAt } },
      { date, createdAt, id: { lt: cursor.id } },
    ],
  };
}

function toItem(row: Prisma.TransactionGetPayload<{ select: typeof listSelect }>) {
  return {
    ...row,
    date: dbToCalendarDate(row.date),
    createdAt: row.createdAt.toISOString(),
    invoiceDueDate: row.invoiceDueDate && dbToCalendarDate(row.invoiceDueDate),
  };
}

export type ListItem = ReturnType<typeof toItem> & { installmentGroupCents: number | null };

/**
 * A page of the space's entries matching `filters`, newest first (date, then registration time,
 * then id), after `cursor`. Also the net total (income − expense, without transfers or invoice
 * payments) of every day on the page, over all its entries matching the filters, and each
 * installment's purchase total.
 */
export async function listTransactions(
  spaceId: string,
  filters: TransactionFilters,
  cursor?: ListCursor,
) {
  const where = await whereFor(spaceId, filters);
  const rows = await db.transaction.findMany({
    where: cursor ? { AND: [where, afterCursor(cursor)] } : where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    select: listSelect,
  });
  const page = rows.slice(0, PAGE_SIZE).map(toItem);
  const last = page.at(-1);
  const nextCursor: ListCursor | null =
    rows.length > PAGE_SIZE && last
      ? { date: last.date, createdAt: last.createdAt, id: last.id }
      : null;

  const days = [...new Set(page.map((i) => i.date))];
  const groupIds = [
    ...new Set(page.flatMap((i) => (i.installmentGroupId ? [i.installmentGroupId] : []))),
  ];
  const [dayGroups, installmentGroups] = await Promise.all([
    days.length === 0
      ? []
      : db.transaction.groupBy({
          by: ["date", "type"],
          where: {
            AND: [
              where,
              { date: { in: days.map(calendarDateToDb) } },
              { type: { in: ["EXPENSE", "INCOME"] } },
            ],
          },
          _sum: { amountCents: true },
        }),
    groupIds.length === 0
      ? []
      : db.transaction.groupBy({
          by: ["installmentGroupId"],
          where: { spaceId, installmentGroupId: { in: groupIds } },
          _sum: { amountCents: true },
        }),
  ]);

  const dayTotals: Record<string, number> = Object.fromEntries(days.map((d) => [d, 0]));
  for (const g of dayGroups) {
    const sign = g.type === "INCOME" ? 1 : -1;
    dayTotals[dbToCalendarDate(g.date)]! += sign * (g._sum.amountCents ?? 0);
  }
  const groupTotal = new Map(
    installmentGroups.map((g) => [g.installmentGroupId!, g._sum.amountCents ?? 0]),
  );
  const items: ListItem[] = page.map((item) => ({
    ...item,
    installmentGroupCents: item.installmentGroupId
      ? (groupTotal.get(item.installmentGroupId) ?? null)
      : null,
  }));
  return { items, nextCursor, dayTotals };
}

export type ListPage = Awaited<ReturnType<typeof listTransactions>>;
