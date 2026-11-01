import "server-only";

import { type CategoryType, selectableTree } from "@/domain/categories";
import { addDays, calendarDateToDb, todayInSaoPaulo } from "@/domain/dates";
import { DEFAULT_CATEGORIES } from "@/domain/default-categories";
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

  const [expense, income] = await Promise.all([forType("EXPENSE"), forType("INCOME")]);
  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    cards: cards.map((c) => ({ id: c.id, name: c.name, cycles: c.cycles })),
    EXPENSE: expense,
    INCOME: income,
  };
}

export type RegisterData = Awaited<ReturnType<typeof registerData>>;
