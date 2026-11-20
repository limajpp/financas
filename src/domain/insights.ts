/**
 * The dashboard's insights: 2–3 plain sentences pointing at where money can be saved. Pure rules
 * over the entries and the categories the metrics already loaded (src/domain/metrics.ts); every
 * limit is in src/domain/insight-limits.ts. Spec: docs/specs/tasks/24-insights.md.
 */
import type { CalendarDate } from "./dates";
import {
  CATEGORY_ABOVE_AVERAGE_RATIO,
  MAX_INSIGHTS,
  MIN_IMPACT_CENTS,
  SMALL_PURCHASE_MAX_CENTS,
  SMALL_PURCHASES_MIN_COUNT,
  TOP_COUNTERPARTY_MIN_SHARE,
} from "./insight-limits";
import { AVERAGE_MONTHS, type CategoryTotal, type MetricsEntry } from "./metrics";
import { formatBRL } from "./money";
import { type Month, type RuleStatus, monthOf } from "./recurring";
import { recentChange, subscriptionTotals } from "./subscriptions";

/** An entry of the metrics, with its counterparty. */
export type InsightEntry = MetricsEntry & { counterparty: { id: string; name: string } | null };

/** An active subscription, with its name (as the subscriptions screen shows it) and its history. */
export type InsightRule = {
  id: string;
  name: string;
  status: RuleStatus;
  amountCents: number;
  /** The changes of amount, in the order they were made (task 19). */
  changes: { changedOn: CalendarDate; previousCents: number; amountCents: number }[];
};

/** The rules, in the order that breaks a tie of impact. */
const KINDS = [
  "CATEGORY_ABOVE_AVERAGE",
  "SMALL_PURCHASES",
  "SUBSCRIPTION_RAISED",
  "SUBSCRIPTIONS_YEARLY",
  "TOP_COUNTERPARTY",
] as const;
export type InsightKind = (typeof KINDS)[number];

export type InsightSubject =
  { type: "category" | "counterparty" | "subscription"; id: string } | { type: "subscriptions" };

export type Insight = {
  kind: InsightKind;
  /** An alert is a new signal; an info is a standing fact that only fills the slots left. */
  group: "alert" | "info";
  /** What it's worth in R$, to rank by. */
  impactCents: number;
  /** The sentence, in pt-BR. */
  text: string;
  /** What the dashboard links it to (task 25). */
  subject: InsightSubject;
};

const brl = formatBRL;
/** A share as a whole percentage, rounded down: never announces a limit it didn't pass. */
const percent = (part: number, whole: number) => `${Math.floor((part * 100) / whole)}%`;

const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });

/** "este mês" for today's month; "em outubro" for another, with the year when it isn't this one. */
export function periodText(month: Month, today: CalendarDate): string {
  if (month === monthOf(today)) return "este mês";
  const [year, m] = month.split("-").map(Number) as [number, number];
  const name = monthName.format(new Date(Date.UTC(year, m - 1, 1)));
  return year === Number(today.slice(0, 4)) ? `em ${name}` : `em ${name} de ${year}`;
}

/** An expense that counts in the indicators (src/domain/metrics.ts). */
const isExpense = (e: MetricsEntry) => e.type === "EXPENSE" && !e.adjustment;

/**
 * Rule 1: a main category whose total in the month is more than 25% and at least R$ 50,00 over
 * its 3-month average. A zero average has no percentage: it fires from R$ 50,00. Without history
 * (a null average) and for the uncategorized expenses, never.
 */
export function categoryInsights(categories: readonly CategoryTotal[], period: string): Insight[] {
  const insights: Insight[] = [];
  for (const c of categories) {
    if (c.id === null || c.averageCents === null) continue;
    const excess = c.totalCents - c.averageCents;
    if (excess < MIN_IMPACT_CENTS) continue;
    if (c.averageCents === 0) {
      insights.push({
        kind: "CATEGORY_ABOVE_AVERAGE",
        group: "alert",
        impactCents: excess,
        text: `${c.name}: ${brl(c.totalCents)} ${period}, sem gastos nos ${AVERAGE_MONTHS} meses anteriores.`,
        subject: { type: "category", id: c.id },
      });
      continue;
    }
    if (excess <= c.averageCents * CATEGORY_ABOVE_AVERAGE_RATIO) continue;
    insights.push({
      kind: "CATEGORY_ABOVE_AVERAGE",
      group: "alert",
      impactCents: excess,
      text: `${c.name}: ${brl(c.totalCents)} ${period}, ${percent(excess, c.averageCents)} acima da média de ${brl(c.averageCents)}.`,
      subject: { type: "category", id: c.id },
    });
  }
  return insights;
}

type Group = { id: string; name: string; entries: InsightEntry[] };

function groupBy(entries: readonly InsightEntry[], key: (e: InsightEntry) => Group | null) {
  const groups = new Map<string, Group>();
  for (const entry of entries) {
    const g = key(entry);
    if (!g) continue;
    const group = groups.get(g.id) ?? { ...g, entries: [] };
    group.entries.push(entry);
    groups.set(g.id, group);
  }
  return [...groups.values()];
}

const total = (entries: readonly MetricsEntry[]) => entries.reduce((s, e) => s + e.amountCents, 0);
const fires = (group: Group) =>
  group.entries.length >= SMALL_PURCHASES_MIN_COUNT && total(group.entries) >= MIN_IMPACT_CENTS;

/**
 * Rule 2: at least 5 purchases of up to R$ 30,00 in the month, adding up to R$ 50,00, at one
 * counterparty; then, with the small purchases left, in one category (the one they were booked
 * on). Installments and subscription charges aren't everyday purchases; a purchase never counts
 * in two insights.
 */
export function smallPurchaseInsights(
  entries: readonly InsightEntry[],
  month: Month,
  period: string,
): Insight[] {
  const small = entries.filter(
    (e) =>
      isExpense(e) &&
      !e.installment &&
      !e.subscription &&
      e.amountCents <= SMALL_PURCHASE_MAX_CENTS &&
      monthOf(e.date) === month,
  );
  const insight = (group: Group, type: "counterparty" | "category"): Insight => {
    const sum = total(group.entries);
    return {
      kind: "SMALL_PURCHASES",
      group: "alert",
      impactCents: sum,
      text: `${group.name}: ${group.entries.length} compras de até ${brl(SMALL_PURCHASE_MAX_CENTS)} somaram ${brl(sum)} ${period}.`,
      subject: { type, id: group.id },
    };
  };
  const byPlace = groupBy(
    small,
    (e) => e.counterparty && { ...e.counterparty, entries: [] },
  ).filter(fires);
  const used = new Set(byPlace.flatMap((g) => g.entries));
  const byCategory = groupBy(
    small.filter((e) => !used.has(e)),
    (e) => e.category && { id: e.category.id, name: e.category.name, entries: [] },
  ).filter(fires);
  return [
    ...byPlace.map((g) => insight(g, "counterparty")),
    ...byCategory.map((g) => insight(g, "category")),
  ];
}

/**
 * Rule 3: an active subscription whose amount went up in the last 90 days (the subscriptions
 * screen's `recentChange`). Its impact is the raise over a year: it doesn't end by itself.
 */
export function subscriptionRaiseInsights(
  rules: readonly InsightRule[],
  today: CalendarDate,
): Insight[] {
  return rules.flatMap((rule): Insight[] => {
    if (rule.status !== "ACTIVE") return [];
    const change = recentChange(rule.changes, rule.amountCents, today);
    if (change?.direction !== "up") return [];
    const yearly = (rule.amountCents - change.previousCents) * 12;
    return [
      {
        kind: "SUBSCRIPTION_RAISED",
        group: "alert",
        impactCents: yearly,
        text: `${rule.name} subiu de ${brl(change.previousCents)} para ${brl(rule.amountCents)}: ${brl(yearly)} a mais por ano.`,
        subject: { type: "subscription", id: rule.id },
      },
    ];
  });
}

/** Rule 4: what the active subscriptions cost in a year. Null without any. */
export function subscriptionsYearlyInsight(rules: readonly InsightRule[]): Insight | null {
  const { monthlyCents, yearlyCents, count } = subscriptionTotals(rules);
  if (count === 0) return null;
  const text =
    count === 1
      ? `Sua assinatura custa ${brl(yearlyCents)} por ano (${brl(monthlyCents)} por mês).`
      : `Suas ${count} assinaturas custam ${brl(yearlyCents)} por ano (${brl(monthlyCents)} por mês).`;
  return {
    kind: "SUBSCRIPTIONS_YEARLY",
    group: "info",
    impactCents: yearlyCents,
    text,
    subject: { type: "subscriptions" },
  };
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

/**
 * Rule 5: the counterparty with the most expenses in the month (each installment in its month),
 * when it takes more than 20% of them and at least R$ 50,00. A tie goes by name.
 */
export function topCounterpartyInsight(
  entries: readonly InsightEntry[],
  month: Month,
  period: string,
): Insight | null {
  const expenses = entries.filter((e) => isExpense(e) && monthOf(e.date) === month);
  const all = total(expenses);
  const [top] = groupBy(expenses, (e) => e.counterparty && { ...e.counterparty, entries: [] })
    .map((g) => ({ ...g, totalCents: total(g.entries) }))
    .sort((a, b) => b.totalCents - a.totalCents || collator.compare(a.name, b.name));
  if (!top || top.totalCents < MIN_IMPACT_CENTS) return null;
  if (top.totalCents <= all * TOP_COUNTERPARTY_MIN_SHARE) return null;
  const purchases = top.entries.length === 1 ? "1 compra" : `${top.entries.length} compras`;
  return {
    kind: "TOP_COUNTERPARTY",
    group: "info",
    impactCents: top.totalCents,
    text: `Onde você mais gastou ${period}: ${top.name}, ${brl(top.totalCents)} em ${purchases} (${percent(top.totalCents, all)} das despesas).`,
    subject: { type: "counterparty", id: top.id },
  };
}

/** Alerts before infos; in each, the biggest impact first, then the rules' order, then the text. */
export function rankInsights(insights: readonly Insight[]): Insight[] {
  const group = (i: Insight) => (i.group === "alert" ? 0 : 1);
  return [...insights]
    .sort(
      (a, b) =>
        group(a) - group(b) ||
        b.impactCents - a.impactCents ||
        KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
        collator.compare(a.text, b.text),
    )
    .slice(0, MAX_INSIGHTS);
}

/**
 * The month's insights, ranked and cut to the dashboard's 3. The subscription rules speak of now:
 * only in today's month. A month not started yet has none (null), like its categories.
 */
export function monthInsights(input: {
  month: Month;
  today: CalendarDate;
  entries: readonly InsightEntry[];
  /** The month's `categoryBreakdown` (src/domain/metrics.ts). */
  categories: readonly CategoryTotal[];
  rules: readonly InsightRule[];
}): Insight[] | null {
  const { month, today, entries, categories, rules } = input;
  const current = monthOf(today);
  if (month > current) return null;
  const period = periodText(month, today);
  const yearly = month === current ? subscriptionsYearlyInsight(rules) : null;
  const top = topCounterpartyInsight(entries, month, period);
  return rankInsights([
    ...categoryInsights(categories, period),
    ...smallPurchaseInsights(entries, month, period),
    ...(month === current ? subscriptionRaiseInsights(rules, today) : []),
    ...(yearly ? [yearly] : []),
    ...(top ? [top] : []),
  ]);
}
