import Link from "next/link";
import { Suspense, cache } from "react";

import { CategoryList } from "@/components/dashboard/category-list";
import { Evolution } from "@/components/dashboard/evolution";
import {
  CardInvoices,
  RecentEntries,
  RegisterButton,
  Shortcuts,
  TodayNumbers,
} from "@/components/dashboard/home-blocks";
import { InsightList } from "@/components/dashboard/insight-list";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MonthSelector } from "@/components/dashboard/month-selector";
import { OnboardingInvite } from "@/components/onboarding/onboarding-invite";
import { InstallHint } from "@/components/pwa/install-hint";
import {
  dashboardKpis,
  firstAverageMonth,
  monthLabel,
  monthNav,
  resolveMonth,
} from "@/domain/dashboard";
import { todayInSaoPaulo } from "@/domain/dates";
import { hasAverageHistory } from "@/domain/metrics";
import { monthOf } from "@/domain/recurring";
import { homeSummary } from "@/server/home";
import { dashboardMetrics, spaceHistoryStart } from "@/server/metrics";
import { needsOnboarding } from "@/server/onboarding";
import { generateRecurringSafely } from "@/server/recurring";
import { getCurrentSpace, getCurrentUser } from "@/server/session";

type Params = Record<string, string | string[] | undefined>;

// Once per request: the phone's home and the summary share them when they show the same month.
const metricsOf = cache((spaceId: string, month: string) => dashboardMetrics(spaceId, month));
const homeOf = cache((spaceId: string) => homeSummary(spaceId));

/**
 * The dashboard on a computer, the home on a phone (task 25): one route, two arrangements. The
 * phone's blocks of today come first (hidden from `md` on); the month's summary follows on both.
 * Each block streams in its own Suspense, so the top shows first.
 */
export default function HomePage({ searchParams }: { searchParams: Promise<Params> }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <Suspense fallback={<h1 className="text-2xl font-semibold tracking-tight">Olá</h1>}>
        <Greeting />
      </Suspense>
      <Suspense>
        <Invite />
      </Suspense>
      <InstallHint />
      <div className="mt-6 grid gap-6 md:hidden">
        <Suspense fallback={<Loading>Carregando o início…</Loading>}>
          <PhoneHome />
        </Suspense>
      </div>
      <Suspense fallback={<Loading className="mt-8">Carregando o resumo do mês…</Loading>}>
        <Summary searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function Loading({ children, className }: { children: string; className?: string }) {
  return <p className={`text-sm text-muted-foreground ${className ?? ""}`}>{children}</p>;
}

async function Greeting() {
  const [user, space] = await Promise.all([getCurrentUser(), getCurrentSpace()]);
  // Opening the app charges the subscriptions due up to today (task 13).
  await generateRecurringSafely(space.id);
  return <h1 className="text-2xl font-semibold tracking-tight">Olá, {user.name}</h1>;
}

/** The onboarding's invitation, while it wasn't finished or dismissed (task 22). */
async function Invite() {
  const space = await getCurrentSpace();
  return (await needsOnboarding(space.id)) ? <OnboardingInvite /> : null;
}

/** The phone's blocks, always of today: the numbers, "Registrar", the cards, the latest entries. */
async function PhoneHome() {
  const space = await getCurrentSpace();
  const today = todayInSaoPaulo();
  const [home, metrics] = await Promise.all([
    homeOf(space.id),
    metricsOf(space.id, monthOf(today)),
  ]);
  // Today's month always has a projection: it carries the "so far" numbers.
  const projection = metrics!.projection!;
  return (
    <>
      <TodayNumbers
        todayCents={home.todayExpenseCents}
        monthCents={projection.expenseToDateCents}
        leftoverCents={projection.leftoverToDateCents}
      />
      <RegisterButton />
      <CardInvoices cards={home.cards} />
      <RecentEntries items={home.recent} today={home.today} />
    </>
  );
}

/** The month's summary: the selector, the KPIs, the insights, the categories, the evolution. */
async function Summary({ searchParams }: { searchParams: Promise<Params> }) {
  const [space, params] = await Promise.all([getCurrentSpace(), searchParams]);
  const today = todayInSaoPaulo();
  const start = await spaceHistoryStart(space.id);
  const month = resolveMonth(typeof params.mes === "string" ? params.mes : undefined, today, start);
  const [metrics, home] = await Promise.all([metricsOf(space.id, month), homeOf(space.id)]);
  // resolveMonth only gives valid months up to today's: never null, categories never null.
  const m = metrics!;
  const kpis = dashboardKpis(m);
  const withAverage = hasAverageHistory(month, start);
  const averagesFrom = monthLabel(firstAverageMonth(start));

  return (
    <section aria-labelledby="resumo" className="mt-8 grid gap-6">
      <MonthSelector nav={monthNav(month, today, start)} current={monthOf(today)} />
      {!home.hasEntries && (
        <div className="grid justify-items-start gap-3 rounded-xl border bg-muted/40 p-4">
          <p className="text-sm">Registre seu primeiro gasto para ver o resumo do mês.</p>
          <Link
            href="/registrar"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Registrar o primeiro gasto
          </Link>
        </div>
      )}
      <KpiCards kpis={home.hasEntries ? kpis : kpis.filter((k) => k.key !== "projection")} />
      <InsightList
        insights={m.insights ?? []}
        month={month}
        note={withAverage ? null : `Os alertas de categoria começam em ${averagesFrom}.`}
      />
      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="categories-title" className="grid content-start gap-3">
          <h3 id="categories-title" className="text-sm font-medium text-muted-foreground">
            Categorias × média
          </h3>
          {!withAverage && (
            <p className="text-xs text-muted-foreground">
              As médias aparecem a partir de {averagesFrom}.
            </p>
          )}
          {m.categories && m.categories.length > 0 ? (
            <CategoryList rows={m.categories} month={month} />
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum gasto neste mês.</p>
          )}
        </section>
        {home.hasEntries && m.evolution && (
          <Evolution evolution={m.evolution} month={month} historyStart={start} />
        )}
      </div>
      <Shortcuts home={home} />
    </section>
  );
}
