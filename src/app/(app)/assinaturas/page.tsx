import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SubscriptionList } from "@/components/subscriptions/subscription-list";
import { Button } from "@/components/ui/button";
import { listOptions } from "@/server/list-options";
import { generateRecurringSafely, listSubscriptions } from "@/server/recurring";
import { getCurrentSpace } from "@/server/session";

export const metadata: Metadata = { title: "Assinaturas · Finanças" };

export default function AssinaturasPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Assinaturas</h1>
      <Suspense fallback={<p className="mt-6 text-muted-foreground">Carregando assinaturas…</p>}>
        <Subscriptions />
      </Suspense>
    </div>
  );
}

async function Subscriptions() {
  const space = await getCurrentSpace();
  // The charges up to today first, so each next date is the real next one (task 13).
  await generateRecurringSafely(space.id);
  const [subscriptions, options] = await Promise.all([
    listSubscriptions(space.id),
    listOptions(space.id),
  ]);

  if (subscriptions.length === 0) {
    return (
      <div className="mt-6 grid justify-items-start gap-3">
        <p className="text-muted-foreground">
          Nenhuma assinatura ainda. Ao registrar uma despesa, ligue “Assinatura” para ela se repetir
          todo mês.
        </p>
        <Button asChild variant="outline" className="h-10">
          <Link href="/registrar">Registrar</Link>
        </Button>
      </div>
    );
  }

  return (
    <SubscriptionList
      subscriptions={subscriptions}
      options={{
        accounts: options.accounts,
        cards: options.cards.map(({ id, name, archived }) => ({ id, name, archived })),
        categories: options.categories.EXPENSE,
      }}
    />
  );
}
