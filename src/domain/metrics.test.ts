import { describe, expect, it } from "vitest";

import {
  type MetricsEntry,
  type MetricsRule,
  categoryBreakdown,
  futureCommitments,
  hasAverageHistory,
  isFixedExpense,
  isMonth,
  monthlyEvolution,
  monthProjection,
  monthSummary,
} from "./metrics";

/*
 * The fixed data set (invented names and amounts). Today is 15/11/2026; the app is in use since
 * 20/07/2026.
 *
 * Categories: Moradia > Aluguel (fixed), Alimentação > Mercado and Restaurante, Lazer, Salário
 * and Reembolsos (income).
 *
 * Aug, Sep, Oct: salary 8.000,00 and rent 2.500,00 each; Mercado 240,00 / 360,00 / 300,00;
 * Restaurante 60,00 in Sep; in Oct a credit purchase of 200,00 on 28/10 at Restaurante (its invoice
 * is due in December: it counts in October) and the 1st of 10 installments of 100,00 (Lazer, from
 * 28/10, so one on the 28th of each month until July).
 *
 * November: salary 8.000,00 (05), rent 2.500,00 (05), Mercado 300,00 (03), Restaurante 120,00
 * (10), 40,00 uncategorized (14), the subscription charge of 39,90 (Lazer, 08), the 2nd
 * installment (28, after today), a refund of 50,00 on credit (12). And what never counts: a
 * transfer, an invoice payment, a reconciliation adjustment and an invoice's opening balance.
 */
const fixed = { id: "aluguel", name: "Aluguel", isFixed: true };
const moradia = { id: "moradia", name: "Moradia", isFixed: false };
const alimentacao = { id: "alimentacao", name: "Alimentação", isFixed: false };
const lazer = { id: "lazer", name: "Lazer", isFixed: false };
const cat = {
  aluguel: { ...fixed, parent: moradia },
  mercado: { id: "mercado", name: "Mercado", isFixed: false, parent: alimentacao },
  restaurante: { id: "restaurante", name: "Restaurante", isFixed: false, parent: alimentacao },
  lazer: { ...lazer, parent: null },
  salario: { id: "salario", name: "Salário", isFixed: false, parent: null },
  reembolsos: { id: "reembolsos", name: "Reembolsos", isFixed: false, parent: null },
};

const base = { adjustment: false, installment: false, subscription: false, category: null };
const expense = (date: string, amountCents: number, extra: Partial<MetricsEntry> = {}) =>
  ({ ...base, type: "EXPENSE", date, amountCents, ...extra }) as MetricsEntry;
const income = (date: string, amountCents: number, extra: Partial<MetricsEntry> = {}) =>
  ({ ...base, type: "INCOME", date, amountCents, ...extra }) as MetricsEntry;

const installments = Array.from({ length: 10 }, (_, i) => {
  const month = 10 + i; // Oct 2026 … Jul 2027
  const y = month > 12 ? 2027 : 2026;
  const m = String(((month - 1) % 12) + 1).padStart(2, "0");
  return expense(`${y}-${m}-28`, 10_000, { installment: true, category: cat.lazer });
});

const entries: MetricsEntry[] = [
  ...["08", "09", "10"].flatMap((m) => [
    income(`2026-${m}-05`, 800_000, { category: cat.salario }),
    expense(`2026-${m}-05`, 250_000, { category: cat.aluguel }),
  ]),
  expense("2026-08-12", 24_000, { category: cat.mercado }),
  expense("2026-09-12", 36_000, { category: cat.mercado }),
  expense("2026-09-20", 6_000, { category: cat.restaurante }),
  expense("2026-10-12", 30_000, { category: cat.mercado }),
  // CA2: on credit, invoice due in December; it counts on its own date.
  expense("2026-10-28", 20_000, { category: cat.restaurante }),
  ...installments,
  income("2026-11-05", 800_000, { category: cat.salario }),
  expense("2026-11-05", 250_000, { category: cat.aluguel }),
  expense("2026-11-03", 30_000, { category: cat.mercado }),
  expense("2026-11-10", 12_000, { category: cat.restaurante }),
  expense("2026-11-14", 4_000),
  expense("2026-11-08", 3_990, { subscription: true, category: cat.lazer }),
  income("2026-11-12", 5_000, { category: cat.reembolsos }),
  // CA5: none of these counts anywhere.
  { ...base, type: "TRANSFER", date: "2026-11-06", amountCents: 100_000 },
  { ...base, type: "CARD_PAYMENT", date: "2026-11-10", amountCents: 50_000 },
  expense("2026-11-11", 7_000, { adjustment: true }),
  expense("2026-11-15", 65_000, { adjustment: true }),
  { ...base, type: "INCOME", date: "2026-11-11", amountCents: 9_000, adjustment: true },
];

const rules: MetricsRule[] = [
  // Charged on 08/11: the cursor is in December.
  { status: "ACTIVE", amountCents: 3_990, dayOfMonth: 8, nextMonth: "2026-12" },
  // Charges on 20/11, still to come.
  { status: "ACTIVE", amountCents: 9_900, dayOfMonth: 20, nextMonth: "2026-11" },
  // Paused: never counts.
  { status: "PAUSED", amountCents: 2_500, dayOfMonth: 25, nextMonth: "2026-11" },
  // Added in the onboarding with its first charge in February.
  { status: "ACTIVE", amountCents: 5_000, dayOfMonth: 2, nextMonth: "2027-02" },
];

const TODAY = "2026-11-15";
const HISTORY = "2026-07-20";

describe("monthSummary", () => {
  it("CA1: novembro", () => {
    // Income: 8.000 + 50 (refund) = 8.050,00.
    // Expense: 2.500 + 300 + 120 + 40 + 39,90 + 100 (the installment on 28/11) = 3.099,90.
    // Fixed: rent 2.500 + subscription 39,90 + installment 100 = 2.639,90; variable 460,00.
    expect(monthSummary(entries, "2026-11")).toEqual({
      month: "2026-11",
      incomeCents: 805_000,
      expenseCents: 309_990,
      leftoverCents: 495_010,
      savingsRate: 495_010 / 805_000,
      fixedCents: 263_990,
      variableCents: 46_000,
    });
  });

  it("CA2: a compra no crédito e a 1ª parcela contam em outubro", () => {
    // 2.500 + 300 + 200 (credit, due in December) + 100 (installment 1) = 3.100,00.
    const october = monthSummary(entries, "2026-10");
    expect(october.expenseCents).toBe(310_000);
    expect(october.fixedCents).toBe(260_000);
    // One installment per month, through July.
    expect(monthSummary(entries, "2027-07").expenseCents).toBe(10_000);
    expect(monthSummary(entries, "2027-08").expenseCents).toBe(0);
  });

  it("CA3: sem receita, a taxa de poupança é null", () => {
    const summary = monthSummary([expense("2026-11-03", 1_000)], "2026-11");
    expect(summary).toMatchObject({ incomeCents: 0, leftoverCents: -1_000, savingsRate: null });
    expect(monthSummary([], "2026-11").savingsRate).toBeNull();
  });

  it("a taxa fica negativa quando se gasta mais do que entra", () => {
    const summary = monthSummary(
      [income("2026-11-01", 1_000), expense("2026-11-02", 1_500)],
      "2026-11",
    );
    expect(summary.savingsRate).toBe(-0.5);
  });

  it("CA5: transferências, pagamentos de fatura e ajustes não contam", () => {
    const noise = entries.filter(
      (e) => e.adjustment || e.type === "TRANSFER" || e.type === "CARD_PAYMENT",
    );
    expect(noise).toHaveLength(5);
    expect(monthSummary(noise, "2026-11")).toMatchObject({
      incomeCents: 0,
      expenseCents: 0,
      fixedCents: 0,
    });
  });
});

describe("isFixedExpense", () => {
  it("assinatura, parcela e categoria fixa (ou a mãe fixa) são fixas", () => {
    expect(isFixedExpense(expense("2026-11-01", 1, { subscription: true }))).toBe(true);
    expect(isFixedExpense(expense("2026-11-01", 1, { installment: true }))).toBe(true);
    expect(isFixedExpense(expense("2026-11-01", 1, { category: cat.aluguel }))).toBe(true);
    const childOfFixed = {
      id: "c",
      name: "Luz",
      isFixed: false,
      parent: { ...moradia, isFixed: true },
    };
    expect(isFixedExpense(expense("2026-11-01", 1, { category: childOfFixed }))).toBe(true);
  });

  it("a mãe não fica fixa por ter uma subcategoria fixa; sem categoria é variável", () => {
    expect(
      isFixedExpense(expense("2026-11-01", 1, { category: { ...moradia, parent: null } })),
    ).toBe(false);
    expect(isFixedExpense(expense("2026-11-01", 1))).toBe(false);
    expect(isFixedExpense(income("2026-11-01", 1, { subscription: true }))).toBe(false);
  });
});

describe("monthProjection", () => {
  it("CA6: no meio do mês", () => {
    // Up to 15/11: 2.500 + 300 + 120 + 40 + 39,90 = 2.999,90; variable 460,00 in 15 days.
    // 15 days left: 460 × 15 / 15 = 460,00.
    // Still to come: the installment on 28/11 (100) + the subscription on 20/11 (99); not the one
    // charged on 08/11, the paused one or the one starting in February. 199,00.
    // Projected: 2.999,90 + 460 + 199 = 3.658,90; leftover 8.050 − 3.658,90 = 4.391,10.
    expect(monthProjection(entries, rules, "2026-11", TODAY)).toEqual({
      expenseToDateCents: 299_990,
      variableToDateCents: 46_000,
      dailyPaceCents: 3_067,
      remainingDays: 15,
      projectedVariableCents: 46_000,
      upcomingFixedCents: 19_900,
      projectedExpenseCents: 365_890,
      projectedLeftoverCents: 439_110,
    });
  });

  it("CA6: no 1º dia, o ritmo é o do dia", () => {
    // 30,00 variable on 01/11: 30 × 29 / 1 = 870,00 more; the subscription of the 20th, 99,00.
    const projection = monthProjection(
      [expense("2026-11-01", 3_000)],
      rules,
      "2026-11",
      "2026-11-01",
    );
    expect(projection).toMatchObject({
      dailyPaceCents: 3_000,
      remainingDays: 29,
      upcomingFixedCents: 9_900,
      projectedExpenseCents: 3_000 + 87_000 + 9_900,
    });
  });

  it("CA6: no último dia, não faltam dias nem cobranças: a projeção é a despesa real", () => {
    const projection = monthProjection(entries, rules, "2026-11", "2026-11-30");
    expect(projection).toMatchObject({ remainingDays: 0, upcomingFixedCents: 0 });
    expect(projection?.projectedExpenseCents).toBe(monthSummary(entries, "2026-11").expenseCents);
  });

  it("arredonda o ritmo × os dias para o centavo", () => {
    // 10,00 in 7 days, 23 left: 1000 × 23 / 7 = 3.285,71… → 3.286 cents. The pace shown is
    // 1000 / 7 = 142,86… → 143; 143 × 23 would be 3.289: the projection uses the exact pace.
    const projection = monthProjection([expense("2026-11-01", 1_000)], [], "2026-11", "2026-11-07");
    expect(projection).toMatchObject({
      dailyPaceCents: 143,
      projectedVariableCents: 3_286,
      projectedExpenseCents: 1_000 + 3_286,
    });
  });

  it("CA6: um mês passado ou futuro não tem projeção", () => {
    expect(monthProjection(entries, rules, "2026-10", TODAY)).toBeNull();
    expect(monthProjection(entries, rules, "2026-12", TODAY)).toBeNull();
  });
});

describe("futureCommitments", () => {
  it("CA1: os próximos 6 meses, de dezembro a maio", () => {
    // Installments: 100 per month. Subscriptions: 39,90 + 99 = 138,90 from December, plus 50 from
    // February (its first charge). Paused: never.
    // Dec, Jan: 238,90; Feb–May: 288,90. Total 2 × 238,90 + 4 × 288,90 = 1.633,40.
    // Installments left from December: Dec–Jul, 8 × 100 = 800,00.
    const result = futureCommitments(entries, rules, TODAY);
    expect(result.months).toEqual([
      {
        month: "2026-12",
        installmentsCents: 10_000,
        subscriptionsCents: 13_890,
        totalCents: 23_890,
      },
      {
        month: "2027-01",
        installmentsCents: 10_000,
        subscriptionsCents: 13_890,
        totalCents: 23_890,
      },
      {
        month: "2027-02",
        installmentsCents: 10_000,
        subscriptionsCents: 18_890,
        totalCents: 28_890,
      },
      {
        month: "2027-03",
        installmentsCents: 10_000,
        subscriptionsCents: 18_890,
        totalCents: 28_890,
      },
      {
        month: "2027-04",
        installmentsCents: 10_000,
        subscriptionsCents: 18_890,
        totalCents: 28_890,
      },
      {
        month: "2027-05",
        installmentsCents: 10_000,
        subscriptionsCents: 18_890,
        totalCents: 28_890,
      },
    ]);
    expect(result.totalCents).toBe(163_340);
    expect(result.remainingInstallmentsCents).toBe(80_000);
  });

  it("sem parcelas nem assinaturas, tudo zero", () => {
    expect(futureCommitments([], [], TODAY, 2)).toEqual({
      months: [
        { month: "2026-12", installmentsCents: 0, subscriptionsCents: 0, totalCents: 0 },
        { month: "2027-01", installmentsCents: 0, subscriptionsCents: 0, totalCents: 0 },
      ],
      totalCents: 0,
      remainingInstallmentsCents: 0,
    });
  });
});

describe("categoryBreakdown", () => {
  it("CA1: novembro por categoria principal, com a média de agosto a outubro", () => {
    // Moradia: 2.500; average (2.500 × 3) / 3 = 2.500.
    // Alimentação: 300 + 120 = 420; average (240 + 420 + 500) / 3 = 386,666… → 386,67.
    // Lazer: 39,90 + 100 = 139,90; average (0 + 0 + 100) / 3 = 33,333… → 33,33.
    // Sem categoria: 40; average 0 (there is history, and nothing then).
    expect(categoryBreakdown(entries, "2026-11", HISTORY)).toEqual([
      {
        id: "moradia",
        name: "Moradia",
        totalCents: 250_000,
        averageCents: 250_000,
        children: [{ id: "aluguel", name: "Aluguel", totalCents: 250_000 }],
      },
      {
        id: "alimentacao",
        name: "Alimentação",
        totalCents: 42_000,
        averageCents: 38_667,
        children: [
          { id: "mercado", name: "Mercado", totalCents: 30_000 },
          { id: "restaurante", name: "Restaurante", totalCents: 12_000 },
        ],
      },
      { id: "lazer", name: "Lazer", totalCents: 13_990, averageCents: 3_333, children: [] },
      { id: null, name: "Sem categoria", totalCents: 4_000, averageCents: 0, children: [] },
    ]);
  });

  it("CA4: sem 3 meses completos de uso, a média é null", () => {
    // In use since 02/08: August wasn't complete.
    const rows = categoryBreakdown(entries, "2026-11", "2026-08-02");
    expect(rows.map((r) => r.averageCents)).toEqual([null, null, null, null]);
    expect(hasAverageHistory("2026-11", "2026-08-01")).toBe(true);
    expect(hasAverageHistory("2026-11", "2026-08-02")).toBe(false);
    // Created on 30/10: January's (Oct–Dec) is hidden, February's (Nov–Jan) shows.
    expect(hasAverageHistory("2027-01", "2026-10-30")).toBe(false);
    expect(hasAverageHistory("2027-02", "2026-10-30")).toBe(true);
  });

  it("uma categoria sem gasto no mês aparece se a média não for zero", () => {
    // December: only the installment (Lazer, 100). Moradia's average (Sep–Nov) is 2.500.
    const rows = categoryBreakdown(entries, "2026-12", HISTORY);
    expect(rows.find((r) => r.id === "moradia")).toMatchObject({
      totalCents: 0,
      averageCents: 250_000,
    });
    expect(rows[0]).toMatchObject({ id: "lazer", totalCents: 10_000 });
  });

  it("o gasto na própria categoria principal vira uma linha quando há subcategorias", () => {
    const own = expense("2026-11-04", 5_000, { category: { ...alimentacao, parent: null } });
    const rows = categoryBreakdown([...entries, own], "2026-11", HISTORY);
    // Alimentação: 300 (Mercado) + 120 (Restaurante) + 50 on Alimentação itself = 470.
    expect(rows.find((r) => r.id === "alimentacao")).toMatchObject({
      totalCents: 47_000,
      children: [
        { id: "mercado", totalCents: 30_000 },
        { id: "restaurante", totalCents: 12_000 },
        { id: "alimentacao", name: "Alimentação", totalCents: 5_000, direct: true },
      ],
    });
  });

  it("CA5: ajustes e receitas não entram", () => {
    expect(categoryBreakdown(entries, "2026-11", HISTORY).some((r) => r.id === "salario")).toBe(
      false,
    );
    expect(
      categoryBreakdown(
        entries.filter((e) => e.adjustment),
        "2026-11",
        HISTORY,
      ),
    ).toEqual([]);
  });
});

describe("monthlyEvolution", () => {
  it("CA1: de junho a novembro, com os meses antes do uso marcados", () => {
    // June ended before 20/07: before the history. July was partial: it counts (as zero).
    const evolution = monthlyEvolution(entries, "2026-11", HISTORY);
    expect(
      evolution.map((m) => [
        m.month,
        m.beforeHistory,
        m.incomeCents,
        m.expenseCents,
        m.leftoverCents,
        m.fixedCents,
        m.variableCents,
      ]),
    ).toEqual([
      ["2026-06", true, 0, 0, 0, 0, 0],
      ["2026-07", false, 0, 0, 0, 0, 0],
      ["2026-08", false, 800_000, 274_000, 526_000, 250_000, 24_000],
      ["2026-09", false, 800_000, 292_000, 508_000, 250_000, 42_000],
      ["2026-10", false, 800_000, 310_000, 490_000, 260_000, 50_000],
      ["2026-11", false, 805_000, 309_990, 495_010, 263_990, 46_000],
    ]);
  });

  it("vira o ano", () => {
    expect(monthlyEvolution([], "2027-02", HISTORY).map((m) => m.month)).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });
});

describe("isMonth", () => {
  it("aceita YYYY-MM de um mês real", () => {
    expect(isMonth("2026-11")).toBe(true);
    expect(isMonth("2000-01")).toBe(true);
    expect(isMonth("2999-12")).toBe(true);
    // Outside 2000–2999 the evolution's months would stop being valid dates.
    for (const v of [
      "2026-13",
      "2026-00",
      "2026-1",
      "26-11",
      "2026-11-01",
      "",
      "1999-12",
      "0050-01",
      "3000-01",
      "9999-12",
    ]) {
      expect(isMonth(v)).toBe(false);
    }
  });
});
