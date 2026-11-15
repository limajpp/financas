import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { InvoiceOverview } from "@/components/invoices/invoice-overview";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listAccounts } from "@/server/accounts";
import { cardsOverview } from "@/server/invoices";
import { generateRecurringSafely } from "@/server/recurring";
import { getCurrentSpace } from "@/server/session";

export const metadata: Metadata = { title: "Faturas · Finanças" };

type Params = Record<string, string | string[] | undefined>;

export default function FaturasPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Faturas</h1>
      <Suspense fallback={<p className="mt-6 text-muted-foreground">Carregando faturas…</p>}>
        <Invoices searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Invoices({ searchParams }: { searchParams: Promise<Params> }) {
  const [space, params] = await Promise.all([getCurrentSpace(), searchParams]);
  // Subscriptions charged up to today first, so their charges are on the invoices (task 13).
  await generateRecurringSafely(space.id);
  const [cards, accounts] = await Promise.all([
    cardsOverview(space.id),
    listAccounts(space.id, { includeArchived: true }),
  ]);

  if (cards.length === 0) {
    return (
      <div className="mt-6 grid justify-items-start gap-3">
        <p className="text-muted-foreground">Você ainda não tem cartões.</p>
        <Button asChild variant="outline" className="h-10">
          <Link href="/contas#cartoes">Cadastrar cartão</Link>
        </Button>
      </div>
    );
  }

  // Active cards first, then archived ones (cardsOverview's order).
  const chosen = cards.find((c) => c.id === params.cartao) ?? cards[0]!;
  return (
    <div className="mt-4 grid gap-6">
      <nav aria-label="Cartões" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex w-max gap-2">
          {cards.map((card) => {
            const current = card.id === chosen.id;
            return (
              <li key={card.id}>
                <Link
                  href={`/faturas?cartao=${card.id}`}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium whitespace-nowrap",
                    current
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {card.name}
                  {card.archivedAt && (
                    <span
                      className={cn("text-xs font-normal", !current && "text-muted-foreground")}
                    >
                      arquivado
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <InvoiceOverview
        key={chosen.id}
        card={{
          id: chosen.id,
          name: chosen.name,
          archived: chosen.archivedAt !== null,
          closingDay: chosen.closingDay,
          dueDay: chosen.dueDay,
          limitCents: chosen.limitCents,
          payment: chosen.payment,
        }}
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.name,
          archived: a.archivedAt !== null,
        }))}
      />
    </div>
  );
}
