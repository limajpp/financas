import { ChevronRight, CreditCard, Plus, Repeat, Store } from "lucide-react";
import Link from "next/link";

import { CategoryIcon } from "@/components/categories/category-icon";
import { describeItem } from "@/components/transactions/describe-item";
import { type CalendarDate, formatCalendarDate } from "@/domain/dates";
import { formatBRL } from "@/domain/money";
import { cn } from "@/lib/utils";
import type { HomeSummary } from "@/server/home";

/** The phone's three numbers (task 25): today's expense, the month's so far, the leftover so far. */
export function TodayNumbers({
  todayCents,
  monthCents,
  leftoverCents,
}: {
  todayCents: number;
  monthCents: number;
  leftoverCents: number;
}) {
  const items = [
    { label: "Gasto hoje", cents: todayCents },
    { label: "Gasto do mês", cents: monthCents },
    { label: "Sobra do mês", cents: leftoverCents },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 rounded-xl border bg-card p-3">
      {items.map((item) => (
        <div key={item.label} role="group" aria-label={item.label} className="grid gap-0.5">
          <span className="text-xs text-muted-foreground">{item.label}</span>
          <span
            className={cn(
              // About 100px a column on a 375px phone: a smaller size there keeps "−R$ 12.345,67" in.
              "text-sm font-semibold tracking-tight min-[400px]:text-base",
              item.cents < 0 && "text-destructive",
            )}
          >
            {formatBRL(item.cents)}
          </span>
        </div>
      ))}
      <span className="col-span-3 text-xs text-muted-foreground">Mês até hoje</span>
    </div>
  );
}

export function RegisterButton() {
  return (
    <Link
      href="/registrar"
      className="flex h-14 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:bg-primary/90"
    >
      <Plus aria-hidden className="size-5" />
      Registrar um lançamento
    </Link>
  );
}

/** The open invoice of each active card; nothing without cards. */
export function CardInvoices({ cards }: { cards: HomeSummary["cards"] }) {
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="home-cards" className="grid gap-2">
      <h2 id="home-cards" className="text-sm font-medium text-muted-foreground">
        Faturas atuais
      </h2>
      <ul className="grid gap-1 rounded-xl border bg-card">
        {cards.map((card) => (
          <li key={card.id} className="border-b last:border-b-0">
            <Link
              href={`/faturas?cartao=${card.id}`}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted"
            >
              <CreditCard aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-sm font-medium">{card.name}</span>
                <span className="text-xs text-muted-foreground">
                  vence em {formatCalendarDate(card.dueDate).slice(0, 5)}
                </span>
              </span>
              <span className="text-sm font-medium tabular-nums">{formatBRL(card.totalCents)}</span>
              <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Hoje", "Ontem" or "07/11". */
function dayOf(date: CalendarDate, today: CalendarDate) {
  if (date === today) return "Hoje";
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (date === yesterday.toISOString().slice(0, 10)) return "Ontem";
  return formatCalendarDate(date).slice(0, 5);
}

/** The latest entries, like the list's rows, and the way to all of them. */
export function RecentEntries({
  items,
  today,
}: {
  items: HomeSummary["recent"];
  today: CalendarDate;
}) {
  return (
    <section aria-labelledby="home-recent" className="grid gap-2">
      <div className="flex items-baseline justify-between">
        <h2 id="home-recent" className="text-sm font-medium text-muted-foreground">
          Últimos lançamentos
        </h2>
        <Link href="/lancamentos" className="text-sm underline underline-offset-4">
          Ver todos
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum lançamento ainda.</p>
      ) : (
        <ul className="grid rounded-xl border bg-card">
          {items.map((item) => {
            const view = describeItem(item);
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
              >
                {item.category ? (
                  <CategoryIcon icon={item.category.icon} color={item.category.color} />
                ) : (
                  <span aria-hidden className="size-8 shrink-0 rounded-lg bg-muted" />
                )}
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{view.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {dayOf(item.date, today)} · {view.line}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-sm font-medium whitespace-nowrap tabular-nums",
                    item.type === "INCOME" && "text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {view.amount}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Where the rest is (design): counterparties, invoices, subscriptions, each with a line of
 * context. The top counterparty is the chosen month's (`period`: "este mês", "em outubro").
 */
export function Shortcuts({
  home,
  top,
  period,
}: {
  home: HomeSummary;
  top: { name: string; totalCents: number } | null;
  period: string;
}) {
  const openInvoices = home.cards.reduce((sum, c) => sum + c.totalCents, 0);
  const items = [
    {
      href: "/estabelecimentos",
      label: "Estabelecimentos",
      icon: Store,
      context: top
        ? `Maior ${period}: ${top.name}, ${formatBRL(top.totalCents)}`
        : `Nenhuma compra ${period}`,
    },
    {
      href: "/faturas",
      label: "Faturas",
      icon: CreditCard,
      context:
        home.cards.length > 0
          ? `${formatBRL(openInvoices)} nas faturas abertas`
          : "Nenhum cartão cadastrado",
    },
    {
      href: "/assinaturas",
      label: "Assinaturas",
      icon: Repeat,
      context:
        home.subscriptions.count > 0
          ? `${formatBRL(home.subscriptions.monthlyCents)} por mês`
          : "Nenhuma assinatura ativa",
    },
  ];
  return (
    <nav aria-label="Atalhos" className="grid gap-2 md:grid-cols-3">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="flex items-center gap-3 rounded-xl border bg-card px-3 py-3 hover:bg-muted"
        >
          <item.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="grid min-w-0 flex-1">
            <span className="text-sm font-medium">{item.label}</span>
            <span className="truncate text-xs text-muted-foreground">{item.context}</span>
          </span>
          <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
        </Link>
      ))}
    </nav>
  );
}
