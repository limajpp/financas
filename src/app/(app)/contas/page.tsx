import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountManager } from "@/components/accounts/account-manager";
import { listAccounts } from "@/server/accounts";
import { getCurrentSpace } from "@/server/session";

export const metadata: Metadata = { title: "Contas · Finanças" };

export default function ContasPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Contas</h1>
      <p className="mt-2 text-muted-foreground">
        O saldo de cada conta parte do saldo inicial na data informada.
      </p>
      <Suspense fallback={<p className="mt-6 text-muted-foreground">Carregando contas…</p>}>
        <Accounts />
      </Suspense>
    </div>
  );
}

async function Accounts() {
  const space = await getCurrentSpace();
  const accounts = await listAccounts(space.id, { includeArchived: true });
  return (
    <AccountManager
      accounts={accounts.map(({ archivedAt, ...account }) => ({
        ...account,
        archived: archivedAt !== null,
      }))}
    />
  );
}
