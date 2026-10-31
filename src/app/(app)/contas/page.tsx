import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountManager } from "@/components/accounts/account-manager";
import { listAccounts } from "@/server/accounts";
import { listCards } from "@/server/cards";
import { getCurrentSpace } from "@/server/session";
import { accountBalances } from "@/server/transactions";

export const metadata: Metadata = { title: "Contas · Finanças" };

export default function ContasPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Contas</h1>
      <p className="mt-2 text-muted-foreground">
        Suas contas e os cartões de crédito que elas pagam.
      </p>
      <Suspense fallback={<p className="mt-6 text-muted-foreground">Carregando contas…</p>}>
        <Accounts />
      </Suspense>
    </div>
  );
}

async function Accounts() {
  const space = await getCurrentSpace();
  const [accounts, cards, balances] = await Promise.all([
    listAccounts(space.id, { includeArchived: true }),
    listCards(space.id, { includeArchived: true }),
    accountBalances(space.id),
  ]);
  return (
    <AccountManager
      accounts={accounts.map(({ archivedAt, ...account }) => ({
        ...account,
        currentBalanceCents: balances.get(account.id) ?? account.initialBalanceCents,
        archived: archivedAt !== null,
      }))}
      cards={cards.map((card) => ({
        id: card.id,
        name: card.name,
        limitCents: card.limitCents,
        archived: card.archivedAt !== null,
        accountId: card.account.id,
        accountName: card.account.name,
        createdToday: card.createdToday,
        closingDay: card.closingDay,
        dueDay: card.dueDay,
        openInvoice: card.openInvoice,
      }))}
    />
  );
}
