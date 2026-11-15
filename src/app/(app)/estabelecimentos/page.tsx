import type { Metadata } from "next";
import { Suspense } from "react";

import { CounterpartyRanking } from "@/components/counterparties/counterparty-ranking";
import { isPeriod } from "@/domain/counterparties";
import { counterpartyRanking } from "@/server/counterparties";
import { listOptions } from "@/server/list-options";
import { getCurrentSpace } from "@/server/session";

export const metadata: Metadata = { title: "Estabelecimentos · Finanças" };

type Params = Record<string, string | string[] | undefined>;

export default function EstabelecimentosPage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Estabelecimentos</h1>
      <Suspense fallback={<p className="mt-6 text-muted-foreground">Carregando…</p>}>
        <Ranking searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Ranking({ searchParams }: { searchParams: Promise<Params> }) {
  const [space, params] = await Promise.all([getCurrentSpace(), searchParams]);
  const period = isPeriod(params.periodo) ? params.periodo : "mes";
  const [rows, options] = await Promise.all([
    counterpartyRanking(space.id, period),
    listOptions(space.id),
  ]);
  return (
    <CounterpartyRanking
      key={period}
      period={period}
      rows={rows}
      counterparties={options.counterparties}
    />
  );
}
