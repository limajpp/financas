import "server-only";

import { type CategoryType, selectableTree } from "@/domain/categories";
import { addDays, calendarDateToDb, todayInSaoPaulo } from "@/domain/dates";
import { DEFAULT_CATEGORIES } from "@/domain/default-categories";
import { suggestionFor } from "@/domain/counterparty-memory";
import {
  type CategoryUsage,
  type PaymentMemory,
  USAGE_WINDOW_DAYS,
  defaultPayment,
  topCategories,
} from "@/domain/register";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { selectableAccounts } from "@/server/accounts";
import { selectableCards } from "@/server/cards";

/** How many entries of `type` used each category in the last USAGE_WINDOW_DAYS days. */
export async function categoryUsage(spaceId: string, type: CategoryType): Promise<CategoryUsage[]> {
  const since = addDays(todayInSaoPaulo(), -USAGE_WINDOW_DAYS);
  const groups = await db.transaction.groupBy({
    by: ["categoryId"],
    where: { spaceId, type, categoryId: { not: null }, date: { gte: calendarDateToDb(since) } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  return groups.map((g) => ({
    categoryId: g.categoryId!,
    count: g._count._all,
    lastUsedAt: g._max.createdAt ?? new Date(0),
  }));
}

/** What the last entries of `type` used: its method, the last non-credit account, the last card. */
export async function paymentMemory(spaceId: string, type: CategoryType): Promise<PaymentMemory> {
  const latest = (where: Prisma.TransactionWhereInput) =>
    db.transaction.findFirst({
      where: { spaceId, type, ...where },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { method: true, accountId: true, cardId: true },
    });
  const [last, lastAccount, lastCard] = await Promise.all([
    latest({}),
    latest({ accountId: { not: null } }),
    latest({ cardId: { not: null } }),
  ]);
  return {
    method: last?.method ?? null,
    accountId: lastAccount?.accountId ?? null,
    cardId: lastCard?.cardId ?? null,
  };
}

/** At most this many counterparties go to the device for the autocomplete (most recent use). */
export const MEMORY_LIMIT = 500;

/**
 * The counterparties for the "O que foi?" autocomplete, with what was learned per entry type.
 * Only counterparties with entries (an orphan from a lost sync race never shows).
 * `selectable` are the active category ids per type.
 */
export async function counterpartyMemory(
  spaceId: string,
  selectable: Record<CategoryType, ReadonlySet<string>>,
  limit = MEMORY_LIMIT,
) {
  const since = calendarDateToDb(addDays(todayInSaoPaulo(), -USAGE_WINDOW_DAYS));
  const withCounterparty = { spaceId, counterpartyId: { not: null } };
  const entryTypes = { in: ["EXPENSE", "INCOME"] as CategoryType[] };
  const [totals, recent, usage, descriptions] = await Promise.all([
    db.transaction.groupBy({
      by: ["counterpartyId"],
      where: withCounterparty,
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    db.transaction.groupBy({
      by: ["counterpartyId"],
      where: { ...withCounterparty, date: { gte: since } },
      _count: { _all: true },
    }),
    db.transaction.groupBy({
      by: ["counterpartyId", "type", "categoryId"],
      where: { ...withCounterparty, type: entryTypes, categoryId: { not: null } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    // The latest description per counterparty and type. DISTINCT ON in SQL: Prisma's
    // `distinct` would read every described entry and dedupe in memory.
    db.$queryRaw<{ counterpartyId: string; type: CategoryType; description: string }[]>`
      SELECT DISTINCT ON ("counterpartyId", "type") "counterpartyId", "type", "description"
      FROM "Transaction"
      WHERE "spaceId" = ${spaceId}
        AND "counterpartyId" IS NOT NULL
        AND "description" IS NOT NULL
        AND "type" IN ('EXPENSE', 'INCOME')
      ORDER BY "counterpartyId", "type", "createdAt" DESC, "id" DESC
    `,
  ]);

  const kept = totals
    .map((t) => ({
      id: t.counterpartyId!,
      useCount: t._count._all,
      lastUsedAt: t._max.createdAt ?? new Date(0),
    }))
    .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
    .slice(0, limit);
  const counterparties = await db.counterparty.findMany({
    where: { spaceId, id: { in: kept.map((k) => k.id) } },
    select: {
      id: true,
      name: true,
      aliases: true,
      document: true,
      defaultCategoryId: true,
      defaultDescription: true,
    },
  });
  const byId = new Map(counterparties.map((c) => [c.id, c]));
  const recentCount = new Map(recent.map((r) => [r.counterpartyId!, r._count._all]));
  const key = (counterpartyId: string, type: string) => `${counterpartyId}:${type}`;
  const usageByKey = new Map<string, { categoryId: string; count: number; lastUsedAt: Date }[]>();
  for (const u of usage) {
    const list = usageByKey.get(key(u.counterpartyId!, u.type)) ?? [];
    list.push({
      categoryId: u.categoryId!,
      count: u._count._all,
      lastUsedAt: u._max.createdAt ?? new Date(0),
    });
    usageByKey.set(key(u.counterpartyId!, u.type), list);
  }
  const descriptionByKey = new Map(
    descriptions.map((d) => [key(d.counterpartyId, d.type), d.description]),
  );

  return kept.flatMap((k) => {
    const counterparty = byId.get(k.id);
    if (!counterparty) return [];
    const suggest = (type: CategoryType) =>
      suggestionFor(
        {
          defaultCategoryId: counterparty.defaultCategoryId,
          defaultDescription: counterparty.defaultDescription,
          categoryUsage: usageByKey.get(key(k.id, type)) ?? [],
          lastDescription: descriptionByKey.get(key(k.id, type)) ?? null,
        },
        selectable[type],
      );
    return [
      {
        id: counterparty.id,
        name: counterparty.name,
        aliases: counterparty.aliases,
        document: counterparty.document,
        useCount: k.useCount,
        recentCount: recentCount.get(k.id) ?? 0,
        lastUsedAt: k.lastUsedAt.getTime(),
        suggestions: { EXPENSE: suggest("EXPENSE"), INCOME: suggest("INCOME") },
      },
    ];
  });
}

const defaultOrder = (type: CategoryType) =>
  DEFAULT_CATEGORIES.filter((c) => c.type === type).map((c) => c.name);

/** Everything the register screen starts with, for both types. */
export async function registerData(spaceId: string) {
  const [accounts, cards, categories] = await Promise.all([
    selectableAccounts(spaceId),
    selectableCards(spaceId),
    db.category.findMany({
      where: { spaceId },
      select: {
        id: true,
        parentId: true,
        name: true,
        type: true,
        icon: true,
        color: true,
        isFixed: true,
        archivedAt: true,
      },
    }),
  ]);

  const forType = async (type: CategoryType) => {
    const tree = selectableTree(categories, type);
    const flat = tree.flatMap(({ children, ...parent }) => [parent, ...children]);
    const [usage, memory] = await Promise.all([
      categoryUsage(spaceId, type),
      paymentMemory(spaceId, type),
    ]);
    const view = <T extends (typeof flat)[number]>(c: T) => ({
      id: c.id,
      parentId: c.parentId,
      name: c.name,
      icon: c.icon,
      color: c.color,
    });
    return {
      tree: tree.map((p) => ({ ...view(p), children: p.children.map(view) })),
      top: topCategories(usage, flat, defaultOrder(type)).map(view),
      payment: defaultPayment(type, memory, accounts, cards),
    };
  };

  const selectableIds = (type: CategoryType) =>
    new Set(
      selectableTree(categories, type).flatMap((p) => [p.id, ...p.children.map((c) => c.id)]),
    );
  const [expense, income, memory] = await Promise.all([
    forType("EXPENSE"),
    forType("INCOME"),
    counterpartyMemory(spaceId, {
      EXPENSE: selectableIds("EXPENSE"),
      INCOME: selectableIds("INCOME"),
    }),
  ]);
  return {
    counterparties: memory,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    cards: cards.map((c) => ({ id: c.id, name: c.name, cycles: c.cycles })),
    EXPENSE: expense,
    INCOME: income,
  };
}

export type RegisterData = Awaited<ReturnType<typeof registerData>>;
