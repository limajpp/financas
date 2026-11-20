import { describe, expect, it } from "vitest";

import {
  type KpiInput,
  categoryVariation,
  dashboardKpis,
  dayExpense,
  firstAverageMonth,
  formatRate,
  isPartialFirstMonth,
  monthDays,
  monthLabel,
  monthNav,
  resolveMonth,
  topCounterparty,
} from "./dashboard";
import type { InsightEntry } from "./insights";
import {
  type FutureCommitments,
  type MonthProjection,
  type MonthSummary,
  hasAverageHistory,
} from "./metrics";
import { formatBRL } from "./money";

// Invented amounts. Today is 15/11/2026; the app is in use since 20/07/2026.
const TODAY = "2026-11-15";
const START = "2026-07-20";
const brl = formatBRL;

const summary = (extra: Partial<MonthSummary> = {}): MonthSummary => ({
  month: "2026-11",
  incomeCents: 805_000,
  expenseCents: 309_990,
  leftoverCents: 495_010,
  savingsRate: 495_010 / 805_000,
  fixedCents: 263_990,
  variableCents: 46_000,
  ...extra,
});
const projection = (extra: Partial<MonthProjection> = {}): MonthProjection => ({
  expenseToDateCents: 299_990,
  variableToDateCents: 46_000,
  dailyPaceCents: 3_067,
  remainingDays: 15,
  projectedVariableCents: 46_000,
  upcomingFixedCents: 19_900,
  projectedExpenseCents: 365_890,
  projectedLeftoverCents: 439_110,
  leftoverToDateCents: 505_010,
  savingsRateToDate: 505_010 / 805_000,
  ...extra,
});
const commitments = (extra: Partial<FutureCommitments> = {}): FutureCommitments => ({
  months: [],
  totalCents: 143_340,
  remainingInstallmentsCents: 80_000,
  ...extra,
});
const current = (extra: Partial<KpiInput> = {}): KpiInput => ({
  month: "2026-11",
  today: TODAY,
  summary: summary(),
  projection: projection(),
  commitments: commitments(),
  ...extra,
});

describe("formatRate", () => {
  it("CA6: uma porcentagem inteira, cortada para baixo, e '—' sem receita", () => {
    expect(formatRate(505_010 / 805_000)).toBe("62%");
    expect(formatRate(0.29)).toBe("29%");
    expect(formatRate(0.25)).toBe("25%");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(-0.129)).toBe("−12%");
    expect(formatRate(1.5)).toBe("150%");
    expect(formatRate(null)).toBe("—");
  });
});

describe("dashboardKpis", () => {
  it("CA6: no mês atual, a sobra e a taxa são até agora, e a projeção é a do mês", () => {
    const [leftover, savings, proj, committed] = dashboardKpis(current());
    expect(leftover).toEqual({
      key: "leftover",
      label: "Sobra até agora",
      value: brl(505_010),
      context: `${brl(805_000)} de receitas, ${brl(299_990)} de despesas`,
      negative: false,
      estimate: false,
    });
    expect(savings).toMatchObject({
      label: "Taxa de poupança",
      value: "62%",
      context: "Da receita do mês, até agora",
    });
    expect(proj).toMatchObject({
      label: "Projeção do mês",
      value: brl(365_890),
      context: `Sobra projetada: ${brl(439_110)}`,
      estimate: false,
    });
    expect(committed).toMatchObject({
      label: "Comprometido no futuro",
      value: brl(143_340),
      context: `Próximos 6 meses · faltam ${brl(80_000)} em parcelas`,
    });
  });

  it("CA6: antes do dia 5, a projeção é uma estimativa; do dia 5 em diante, não", () => {
    const early = dashboardKpis(current({ today: "2026-11-04" }))[2]!;
    expect(early).toMatchObject({ estimate: true, context: "Poucos dias para projetar." });
    expect(dashboardKpis(current({ today: "2026-11-05" }))[2]!.estimate).toBe(false);
  });

  it("CA6: sem receita, a taxa é '—' e diz por quê; uma sobra negativa vem marcada", () => {
    const [leftover, savings] = dashboardKpis(
      current({
        summary: summary({ incomeCents: 0 }),
        projection: projection({ leftoverToDateCents: -299_990, savingsRateToDate: null }),
      }),
    );
    expect(leftover).toMatchObject({ value: brl(-299_990), negative: true });
    expect(savings).toMatchObject({ value: "—", context: "Sem receitas no mês", negative: false });
  });

  it("CA6: num mês passado, a projeção vira a despesa do mês, e a sobra é a do mês", () => {
    const [leftover, savings, proj, committed] = dashboardKpis(
      current({
        month: "2026-10",
        summary: summary({
          month: "2026-10",
          incomeCents: 800_000,
          expenseCents: 310_000,
          leftoverCents: 490_000,
          savingsRate: 490_000 / 800_000,
        }),
        projection: null,
      }),
    );
    expect(leftover).toMatchObject({
      label: "Sobra",
      value: brl(490_000),
      context: `${brl(800_000)} de receitas, ${brl(310_000)} de despesas`,
    });
    expect(savings).toMatchObject({ value: "61%", context: "Da receita do mês" });
    expect(proj).toMatchObject({
      key: "projection",
      label: "Despesa do mês",
      value: brl(310_000),
      context: "O valor final do mês",
      estimate: false,
    });
    expect(committed!.context).toBe(
      `Próximos 6 meses, a partir de hoje · faltam ${brl(80_000)} em parcelas`,
    );
  });

  it("sem parcelas a pagar, o comprometido diz isso", () => {
    const committed = dashboardKpis(
      current({ commitments: commitments({ remainingInstallmentsCents: 0 }) }),
    )[3]!;
    expect(committed.context).toBe("Próximos 6 meses · sem parcelas a pagar");
  });
});

describe("o seletor de mês", () => {
  it("CA6: o nome do mês", () => {
    expect(monthLabel("2026-11")).toBe("novembro de 2026");
    expect(monthLabel("2027-03")).toBe("março de 2027");
  });

  it("resolveMonth: um mês válido do histórico; senão o atual ou o início", () => {
    expect(resolveMonth("2026-10", TODAY, START)).toBe("2026-10");
    expect(resolveMonth("2026-07", TODAY, START)).toBe("2026-07");
    expect(resolveMonth(undefined, TODAY, START)).toBe("2026-11");
    expect(resolveMonth("novembro", TODAY, START)).toBe("2026-11");
    expect(resolveMonth("2026-13", TODAY, START)).toBe("2026-11");
    // A future month: the current one. Before the history: its first month.
    expect(resolveMonth("2026-12", TODAY, START)).toBe("2026-11");
    expect(resolveMonth("2025-01", TODAY, START)).toBe("2026-07");
  });

  it("monthNav: sem 'próximo' no mês atual, sem 'anterior' no início do histórico", () => {
    expect(monthNav("2026-11", TODAY, START)).toEqual({
      label: "novembro de 2026",
      previous: "2026-10",
      next: null,
      isCurrent: true,
    });
    expect(monthNav("2026-08", TODAY, START)).toEqual({
      label: "agosto de 2026",
      previous: "2026-07",
      next: "2026-09",
      isCurrent: false,
    });
    expect(monthNav("2026-07", TODAY, START).previous).toBeNull();
  });

  it("monthDays: o primeiro e o último dia do mês", () => {
    expect(monthDays("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthDays("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});

describe("categoryVariation", () => {
  it("a variação sobre a média, cortada para baixo, com o alerta pela regra dos insights", () => {
    expect(categoryVariation(82_000, 56_000)).toEqual({ text: "+46%", alert: true });
    // 25% exactly isn't an alert (rule 1 wants more than 25%).
    expect(categoryVariation(50_000, 40_000)).toEqual({ text: "+25%", alert: false });
    expect(categoryVariation(44_000, 50_000)).toEqual({ text: "−12%", alert: false });
    expect(categoryVariation(50_000, 50_000)).toEqual({ text: "0%", alert: false });
  });

  it("sem média não há variação; com média zero, é 'novo'", () => {
    expect(categoryVariation(82_000, null)).toBeNull();
    expect(categoryVariation(60_000, 0)).toEqual({ text: "novo", alert: true });
    expect(categoryVariation(1_000, 0)).toEqual({ text: "novo", alert: false });
    expect(categoryVariation(0, 0)).toBeNull();
  });
});

describe("isPartialFirstMonth", () => {
  it("o mês do início do histórico, quando não começou no dia 1º", () => {
    expect(isPartialFirstMonth("2026-07", START)).toBe(true);
    expect(isPartialFirstMonth("2026-08", START)).toBe(false);
    expect(isPartialFirstMonth("2026-08", "2026-08-01")).toBe(false);
  });
});

describe("firstAverageMonth", () => {
  it("o primeiro mês com média, que bate com hasAverageHistory", () => {
    // From 20/07: Aug–Oct are whole, so November has its average.
    expect(firstAverageMonth(START)).toBe("2026-11");
    expect(hasAverageHistory("2026-11", START)).toBe(true);
    expect(hasAverageHistory("2026-10", START)).toBe(false);
    // From 01/08: Aug–Oct too.
    expect(firstAverageMonth("2026-08-01")).toBe("2026-11");
    expect(firstAverageMonth("2026-12-31")).toBe("2027-04");
  });
});

const entry = (date: string, amountCents: number, extra: Partial<InsightEntry> = {}) =>
  ({
    type: "EXPENSE",
    date,
    amountCents,
    adjustment: false,
    installment: false,
    subscription: false,
    category: null,
    counterparty: null,
    ...extra,
  }) as InsightEntry;

describe("dayExpense", () => {
  it("as despesas do dia que contam: sem receitas, transferências nem ajustes", () => {
    expect(
      dayExpense(
        [
          entry(TODAY, 4_500),
          entry(TODAY, 3_990, { subscription: true }),
          entry(TODAY, 100_000, { type: "INCOME" }),
          entry(TODAY, 50_000, { type: "TRANSFER" }),
          entry(TODAY, 7_000, { adjustment: true }),
          entry("2026-11-14", 2_000),
        ],
        TODAY,
      ),
    ).toBe(8_490);
  });
});

describe("topCounterparty", () => {
  const mercado = { id: "mercado", name: "Mercado Bom Preço" };
  const cafe = { id: "cafe", name: "Café da Esquina" };

  it("o lugar com o maior total no mês, com assinaturas e parcelas do mês", () => {
    expect(
      topCounterparty(
        [
          entry("2026-11-03", 30_000, { counterparty: mercado }),
          entry("2026-11-04", 20_000, { counterparty: cafe }),
          entry("2026-11-05", 15_000, { counterparty: cafe, subscription: true }),
          // Another month, an income and an adjustment don't count.
          entry("2026-10-03", 99_000, { counterparty: cafe }),
          entry("2026-11-03", 99_000, { counterparty: cafe, type: "INCOME" }),
          entry("2026-11-03", 99_000, { counterparty: cafe, adjustment: true }),
        ],
        "2026-11",
      ),
    ).toEqual({ id: "cafe", name: "Café da Esquina", totalCents: 35_000 });
  });

  it("um empate vai pelo nome; sem lugar, null", () => {
    expect(
      topCounterparty(
        [
          entry("2026-11-03", 10_000, { counterparty: mercado }),
          entry("2026-11-03", 10_000, { counterparty: cafe }),
        ],
        "2026-11",
      )?.name,
    ).toBe("Café da Esquina");
    expect(topCounterparty([entry("2026-11-03", 10_000)], "2026-11")).toBeNull();
  });
});
