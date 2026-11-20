import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CounterpartyDetailView } from "@/components/counterparties/counterparty-detail";
import { isPeriod } from "@/domain/counterparties";
import { todayInSaoPaulo } from "@/domain/dates";
import { counterpartyDetail } from "@/server/counterparties";
import { listOptions } from "@/server/list-options";
import { getCurrentSpace } from "@/server/session";

export const metadata: Metadata = { title: "Estabelecimento · Finanças" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function EstabelecimentoPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Detail({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [space, { id }, query] = await Promise.all([getCurrentSpace(), params, searchParams]);
  const period = isPeriod(query.periodo) ? query.periodo : "mes";
  const uuid = /^[0-9a-f-]{36}$/i.test(id);
  const [detail, options] = await Promise.all([
    uuid ? counterpartyDetail(space.id, id, period) : null,
    listOptions(space.id),
  ]);
  if (!detail) {
    return (
      <div className="grid justify-items-start gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Estabelecimento não encontrado</h1>
        <Link href="/estabelecimentos" className="text-sm underline underline-offset-4">
          Ver os estabelecimentos
        </Link>
      </div>
    );
  }
  return (
    <CounterpartyDetailView
      key={`${detail.counterparty.id}:${period}`}
      detail={detail}
      period={period}
      options={options}
      today={todayInSaoPaulo()}
    />
  );
}
