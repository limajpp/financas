import "server-only";

import { type Period, averageTicket, mergeMemory, periodRange } from "@/domain/counterparties";
import { calendarDateToDb, todayInSaoPaulo } from "@/domain/dates";
import { GENERATED_CLIENT_ID_PREFIX } from "@/domain/recurring";
import { normalizeName } from "@/domain/names";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { listTransactions } from "@/server/transaction-list";

/** How many entries the detail shows (the rest is in the transactions list). */
export const DETAIL_ITEMS = 10;

function periodWhere(spaceId: string, period: Period) {
  const { from, to } = periodRange(period, todayInSaoPaulo());
  return {
    range: { from, to },
    where: {
      spaceId,
      type: "EXPENSE" as const,
      counterpartyId: { not: null },
      date: { gte: calendarDateToDb(from), lte: calendarDateToDb(to) },
    },
  };
}

/** A purchase in installments counts once, by its 1st installment. */
const ONE_PER_PURCHASE = { OR: [{ installmentNumber: null }, { installmentNumber: 1 }] };

/**
 * The counterparties with expenses in the period: the total (each installment in its month), the
 * purchases (a purchase in installments once) and the most used category. Aggregated in the
 * database; the order is up to the caller (rankCounterparties).
 */
export async function counterpartyRanking(spaceId: string, period: Period) {
  const { where } = periodWhere(spaceId, period);
  const [totals, purchases, categories] = await Promise.all([
    db.transaction.groupBy({ by: ["counterpartyId"], where, _sum: { amountCents: true } }),
    db.transaction.groupBy({
      by: ["counterpartyId"],
      where: { ...where, ...ONE_PER_PURCHASE },
      _count: { _all: true },
    }),
    // The most used category counts like the register's usage (task 10): a purchase in
    // installments once, and no charge the generation made.
    db.transaction.groupBy({
      by: ["counterpartyId", "categoryId"],
      where: {
        ...where,
        ...ONE_PER_PURCHASE,
        categoryId: { not: null },
        NOT: { clientId: { startsWith: GENERATED_CLIENT_ID_PREFIX } },
      },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  ]);
  const ids = totals.map((t) => t.counterpartyId!);
  const topCategory = new Map<string, { categoryId: string; count: number; last: number }>();
  for (const c of categories) {
    const current = topCategory.get(c.counterpartyId!);
    const candidate = {
      categoryId: c.categoryId!,
      count: c._count._all,
      last: c._max.createdAt?.getTime() ?? 0,
    };
    if (
      !current ||
      candidate.count > current.count ||
      (candidate.count === current.count && candidate.last > current.last)
    ) {
      topCategory.set(c.counterpartyId!, candidate);
    }
  }
  const [rows, categoryRows] = await Promise.all([
    db.counterparty.findMany({
      where: { spaceId, id: { in: ids } },
      select: { id: true, name: true },
    }),
    db.category.findMany({
      where: { spaceId, id: { in: [...topCategory.values()].map((t) => t.categoryId) } },
      select: { id: true, name: true, icon: true, color: true },
    }),
  ]);
  const totalOf = new Map(totals.map((t) => [t.counterpartyId!, t._sum.amountCents ?? 0]));
  const countOf = new Map(purchases.map((p) => [p.counterpartyId!, p._count._all]));
  const categoryOf = new Map(categoryRows.map((c) => [c.id, c]));
  return rows.map((row) => {
    const top = topCategory.get(row.id);
    return {
      ...row,
      totalCents: totalOf.get(row.id) ?? 0,
      purchases: countOf.get(row.id) ?? 0,
      category: (top && categoryOf.get(top.categoryId)) ?? null,
    };
  });
}

export type RankingRow = Awaited<ReturnType<typeof counterpartyRanking>>[number];

/**
 * One counterparty of the space: its memory, the period's total, purchases and average ticket,
 * and its latest entries in the period. Null when it isn't in the space.
 */
export async function counterpartyDetail(spaceId: string, id: string, period: Period) {
  const counterparty = await db.counterparty.findFirst({
    where: { id, spaceId },
    select: {
      id: true,
      name: true,
      aliases: true,
      document: true,
      defaultCategoryId: true,
      defaultDescription: true,
    },
  });
  if (!counterparty) return null;
  const { range, where } = periodWhere(spaceId, period);
  const mine = { ...where, counterpartyId: id };
  const [total, purchases, page] = await Promise.all([
    db.transaction.aggregate({ where: mine, _sum: { amountCents: true } }),
    db.transaction.count({ where: { ...mine, ...ONE_PER_PURCHASE } }),
    listTransactions(spaceId, { ...range, counterpartyId: id }),
  ]);
  const totalCents = total._sum.amountCents ?? 0;
  return {
    counterparty,
    range,
    totalCents,
    purchases,
    averageCents: averageTicket(totalCents, purchases),
    items: page.items.slice(0, DETAIL_ITEMS),
    more: page.items.length > DETAIL_ITEMS,
  };
}

export type CounterpartyDetail = NonNullable<Awaited<ReturnType<typeof counterpartyDetail>>>;

export type CounterpartyError =
  "NOT_FOUND" | "NAME_TAKEN" | "CATEGORY_NOT_FOUND" | "CATEGORY_ARCHIVED" | "SAME_COUNTERPARTY";

export const COUNTERPARTY_ERROR_MESSAGES: Record<CounterpartyError, string> = {
  NOT_FOUND: "Estabelecimento não encontrado.",
  NAME_TAKEN: "Já existe um estabelecimento com esse nome. Para juntar os dois, use “Mesclar”.",
  CATEGORY_NOT_FOUND: "Categoria não encontrada.",
  CATEGORY_ARCHIVED: "Essa categoria está arquivada. Escolha outra.",
  SAME_COUNTERPARTY: "Escolha outro estabelecimento para mesclar.",
};

export type MemoryInput = {
  name: string;
  aliases: string[];
  document: string | null;
  defaultCategoryId: string | null;
  defaultDescription: string | null;
};

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Edits a counterparty's memory. The entries keep pointing to it (they show the new name). */
export async function updateCounterparty(
  spaceId: string,
  id: string,
  input: MemoryInput,
): Promise<{ ok: true } | { ok: false; error: CounterpartyError }> {
  const current = await db.counterparty.findFirst({
    where: { id, spaceId },
    select: { defaultCategoryId: true },
  });
  if (!current) return { ok: false, error: "NOT_FOUND" };
  if (input.defaultCategoryId !== null) {
    const category = await db.category.findFirst({
      where: { id: input.defaultCategoryId, spaceId },
      select: { archivedAt: true, parent: { select: { archivedAt: true } } },
    });
    if (!category) return { ok: false, error: "CATEGORY_NOT_FOUND" };
    const archived = category.archivedAt !== null || (category.parent?.archivedAt ?? null) !== null;
    // The one it already had may stay, even archived since.
    if (archived && input.defaultCategoryId !== current.defaultCategoryId) {
      return { ok: false, error: "CATEGORY_ARCHIVED" };
    }
  }
  const nameKey = normalizeName(input.name);
  try {
    return await db.$transaction(async (tx) => {
      // An orphan (no entries, no subscriptions: a lost race of task 8) holding the name gives it
      // up: it shows nowhere, so nothing could be merged with it.
      await tx.counterparty.deleteMany({
        where: {
          spaceId,
          nameKey,
          id: { not: id },
          transactions: { none: {} },
          recurringRules: { none: {} },
        },
      });
      const { count } = await tx.counterparty.updateMany({
        where: { id, spaceId },
        data: { ...input, nameKey },
      });
      return count > 0
        ? { ok: true as const }
        : { ok: false as const, error: "NOT_FOUND" as const };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "NAME_TAKEN" };
    throw error;
  }
}

/** What merging `absorbedId` into `keepId` would do: for the confirmation. */
export async function mergePreview(spaceId: string, keepId: string, absorbedId: string) {
  if (keepId === absorbedId) return { ok: false as const, error: "SAME_COUNTERPARTY" as const };
  const [keep, absorbed] = await Promise.all([
    findMemory(spaceId, keepId),
    findMemory(spaceId, absorbedId),
  ]);
  if (!keep || !absorbed) return { ok: false as const, error: "NOT_FOUND" as const };
  const [entries, subscriptions] = await Promise.all([
    db.transaction.count({ where: { spaceId, counterpartyId: absorbedId } }),
    db.recurringRule.count({ where: { spaceId, counterpartyId: absorbedId } }),
  ]);
  const merged = mergeMemory(keep, absorbed);
  return {
    ok: true as const,
    keepName: keep.name,
    absorbedName: absorbed.name,
    entries,
    subscriptions,
    documentDropped: merged.documentDropped,
  };
}

function findMemory(spaceId: string, id: string) {
  return db.counterparty.findFirst({
    where: { id, spaceId },
    select: {
      name: true,
      aliases: true,
      document: true,
      defaultCategoryId: true,
      defaultDescription: true,
    },
  });
}

/**
 * Merges `absorbedId` into `keepId`, in one database transaction: its entries and subscriptions
 * move over, its name and aliases join the aliases, its document and defaults fill what's missing,
 * and it's deleted. No undo.
 */
export async function mergeCounterparties(
  spaceId: string,
  keepId: string,
  absorbedId: string,
): Promise<{ ok: true; moved: number } | { ok: false; error: CounterpartyError }> {
  if (keepId === absorbedId) return { ok: false, error: "SAME_COUNTERPARTY" };
  return db.$transaction(async (tx) => {
    // The absorbed one's subscriptions first: the generation (task 13) locks a rule and then
    // inserts a charge pointing to its counterparty. Taking the rules before the counterparty
    // keeps the same order, so the two can't deadlock.
    await tx.$queryRaw`
      SELECT "id" FROM "RecurringRule"
      WHERE "spaceId" = ${spaceId} AND "counterpartyId" = ${absorbedId}
      ORDER BY "id" FOR UPDATE
    `;
    // Then both counterparties until the end (in id order, so two opposite merges can't
    // deadlock).
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Counterparty"
      WHERE "spaceId" = ${spaceId} AND "id" IN (${keepId}, ${absorbedId})
      ORDER BY "id" FOR UPDATE
    `;
    if (locked.length !== 2) return { ok: false as const, error: "NOT_FOUND" as const };
    const [keep, absorbed] = await Promise.all([
      tx.counterparty.findUniqueOrThrow({ where: { id: keepId } }),
      tx.counterparty.findUniqueOrThrow({ where: { id: absorbedId } }),
    ]);
    const merged = mergeMemory(keep, absorbed);
    const memory = {
      aliases: merged.aliases,
      document: merged.document,
      defaultCategoryId: merged.defaultCategoryId,
      defaultDescription: merged.defaultDescription,
    };
    const moved = await tx.transaction.updateMany({
      where: { spaceId, counterpartyId: absorbedId },
      data: { counterpartyId: keepId },
    });
    await tx.recurringRule.updateMany({
      where: { spaceId, counterpartyId: absorbedId },
      data: { counterpartyId: keepId },
    });
    await tx.counterparty.delete({ where: { id: absorbedId } });
    await tx.counterparty.update({ where: { id: keepId }, data: memory });
    return { ok: true as const, moved: moved.count };
  });
}
