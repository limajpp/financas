import type { Metadata } from "next";
import { Suspense } from "react";

import { TransactionFiltersBar, TransactionList } from "@/components/transactions/transaction-list";
import { todayInSaoPaulo } from "@/domain/dates";
import { db } from "@/lib/db";
import { filtersToParams, parseFilters } from "@/lib/validation/transaction-filters";
import { listAccounts } from "@/server/accounts";
import { listCards } from "@/server/cards";
import { listCategories } from "@/server/categories";
import { generateRecurringSafely } from "@/server/recurring";
import { registerData } from "@/server/register";
import { getCurrentSpace } from "@/server/session";
import { listTransactions } from "@/server/transaction-list";

export const metadata: Metadata = { title: "Lançamentos · Finanças" };

type Params = Record<string, string | string[] | undefined>;

export default function LancamentosPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Lançamentos</h1>
      <Suspense fallback={<p className="mt-6 text-muted-foreground">Carregando lançamentos…</p>}>
        <Transactions searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Transactions({ searchParams }: { searchParams: Promise<Params> }) {
  const [space, params] = await Promise.all([getCurrentSpace(), searchParams]);
  // Subscriptions charged up to today first (task 13).
  await generateRecurringSafely(space.id);
  const today = todayInSaoPaulo();
  const filters = parseFilters(params, today);
  const [page, accounts, cards, register, categories, filterCounterparty] = await Promise.all([
    listTransactions(space.id, filters),
    listAccounts(space.id, { includeArchived: true }),
    listCards(space.id, { includeArchived: true }),
    registerData(space.id),
    listCategories(space.id, { includeArchived: true }),
    filters.counterpartyId
      ? db.counterparty.findFirst({
          where: { id: filters.counterpartyId, spaceId: space.id },
          select: { id: true, name: true },
        })
      : null,
  ]);
  const query = filtersToParams(filters).toString();
  const options = {
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
  return (
    <div className="mt-4 grid gap-4">
      <TransactionFiltersBar filters={filters} options={options} />
      <TransactionList
        // A new filter is a new list: no leftover pages or selection.
        key={query}
        filters={filters}
        today={today}
        initialPage={page}
        options={options}
      />
    </div>
  );
}
