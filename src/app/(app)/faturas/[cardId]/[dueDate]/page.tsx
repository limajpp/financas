import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { InvoiceDetailView } from "@/components/invoices/invoice-detail";
import { todayInSaoPaulo } from "@/domain/dates";
import { listAccounts } from "@/server/accounts";
import { invoiceDetail } from "@/server/invoices";
import { listOptions } from "@/server/list-options";
import { generateRecurringSafely } from "@/server/recurring";
import { getCurrentSpace } from "@/server/session";

export const metadata: Metadata = { title: "Fatura · Finanças" };

type Params = Promise<{ cardId: string; dueDate: string }>;

export default function FaturaPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <Suspense fallback={<p className="text-muted-foreground">Carregando fatura…</p>}>
        <Invoice params={params} />
      </Suspense>
    </div>
  );
}

async function Invoice({ params }: { params: Params }) {
  const [space, { cardId, dueDate }] = await Promise.all([getCurrentSpace(), params]);
  // Subscriptions charged up to today first, so their charges are on the invoice (task 13).
  await generateRecurringSafely(space.id);
  const [detail, accounts, options] = await Promise.all([
    invoiceDetail(space.id, cardId, dueDate),
    listAccounts(space.id, { includeArchived: true }),
    listOptions(space.id),
  ]);

  if (!detail) {
    return (
      <div className="grid justify-items-start gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Fatura não encontrada</h1>
        <p className="text-muted-foreground">Esse cartão não tem essa fatura.</p>
        <Link href="/faturas" className="text-sm underline underline-offset-4">
          Ver as faturas
        </Link>
      </div>
    );
  }

  const { card, summary, items } = detail;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Fatura · {card.name}</h1>
      <InvoiceDetailView
        card={{ id: card.id, name: card.name, payment: card.payment }}
        summary={summary}
        items={items}
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.name,
          archived: a.archivedAt !== null,
        }))}
        options={options}
        today={todayInSaoPaulo()}
      />
    </>
  );
}
