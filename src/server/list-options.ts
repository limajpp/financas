import "server-only";

import type { ListOptions } from "@/components/transactions/types";
import { db } from "@/lib/db";
import { listAccounts } from "@/server/accounts";
import { listCards } from "@/server/cards";
import { listCategories } from "@/server/categories";
import { registerData } from "@/server/register";

/**
 * What the transactions list's filters and edit form offer: accounts, cards and categories
 * (archived ones included), counterparties, and the counterparty in the filter when it's an old
 * one. The invoice detail (task 18) uses the same edit form.
 */
export async function listOptions(
  spaceId: string,
  filterCounterpartyId: string | null = null,
): Promise<ListOptions> {
  const [accounts, cards, register, categories, filterCounterparty] = await Promise.all([
    listAccounts(spaceId, { includeArchived: true }),
    listCards(spaceId, { includeArchived: true }),
    registerData(spaceId),
    listCategories(spaceId, { includeArchived: true }),
    filterCounterpartyId
      ? db.counterparty.findFirst({
          where: { id: filterCounterpartyId, spaceId },
          select: { id: true, name: true },
        })
      : null,
  ]);
  return {
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, archived: a.archivedAt !== null })),
    cards: cards.map((c) => ({
      id: c.id,
      name: c.name,
      archived: c.archivedAt !== null,
      cycles: c.cycles,
    })),
    categories: { EXPENSE: register.EXPENSE.tree, INCOME: register.INCOME.tree },
    counterparties: register.counterparties,
    filterCategories: categories.map((parent) => ({
      id: parent.id,
      name: parent.name,
      archived: parent.archivedAt !== null,
      children: parent.children.map((child) => ({
        id: child.id,
        name: child.name,
        archived: child.archivedAt !== null || parent.archivedAt !== null,
      })),
    })),
    filterCounterparty:
      filterCounterparty && !register.counterparties.some((c) => c.id === filterCounterparty.id)
        ? filterCounterparty
        : null,
  };
}
