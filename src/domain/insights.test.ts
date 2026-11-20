import { describe, expect, it } from "vitest";

import {
  CATEGORY_ABOVE_AVERAGE_RATIO,
  MAX_INSIGHTS,
  MIN_IMPACT_CENTS,
  SMALL_PURCHASE_MAX_CENTS,
  SMALL_PURCHASES_MIN_COUNT,
  SUBSCRIPTION_CHANGE_DAYS,
  TOP_COUNTERPARTY_MIN_SHARE,
} from "./insight-limits";
import {
  type Insight,
  type InsightEntry,
  type InsightRule,
  categoryInsights,
  monthInsights,
  periodText,
  rankInsights,
  smallPurchaseInsights,
  subscriptionRaiseInsights,
  subscriptionsYearlyInsight,
  topCounterpartyInsight,
} from "./insights";
import type { CategoryTotal } from "./metrics";
import { formatBRL } from "./money";

// Invented names and amounts. Today is 15/11/2026.
const TODAY = "2026-11-15";
const NOV = "2026-11";
const PERIOD = "este mês";

const alimentacao = { id: "alimentacao", name: "Alimentação", isFixed: false };
const cat = {
  lanches: { id: "lanches", name: "Lanches", isFixed: false, parent: alimentacao },
  mercado: { id: "mercado", name: "Mercado", isFixed: false, parent: alimentacao },
  lazer: { id: "lazer", name: "Lazer", isFixed: false, parent: null },
};
const padaria = { id: "padaria", name: "Padaria Pão Quente" };
const cafe = { id: "cafe", name: "Café da Esquina" };
const mercadoBom = { id: "mercado-bom", name: "Mercado Bom Preço" };

const base = {
  type: "EXPENSE",
  adjustment: false,
  installment: false,
  subscription: false,
  category: null,
  counterparty: null,
} as const;
const expense = (date: string, amountCents: number, extra: Partial<InsightEntry> = {}) =>
  ({ ...base, date, amountCents, ...extra }) as InsightEntry;
/** `count` purchases of `amountCents` in November, from the 1st on. */
const several = (count: number, amountCents: number, extra: Partial<InsightEntry> = {}) =>
  Array.from({ length: count }, (_, i) =>
    expense(`2026-11-${String(i + 1).padStart(2, "0")}`, amountCents, extra),
  );

const category = (
  name: string,
  totalCents: number,
  averageCents: number | null,
  id: string | null = name.toLowerCase(),
): CategoryTotal => ({ id, name, totalCents, averageCents, children: [] });

const rule = (extra: Partial<InsightRule> = {}): InsightRule => ({
  id: "streamflix",
  name: "Streamflix",
  status: "ACTIVE",
  amountCents: 4_490,
  changes: [],
  ...extra,
});

const brl = formatBRL;

describe("os limites", () => {
  it("CA7: estão no módulo de constantes, com os valores da spec", () => {
    expect(CATEGORY_ABOVE_AVERAGE_RATIO).toBe(0.25);
    expect(MIN_IMPACT_CENTS).toBe(5_000);
    expect(SMALL_PURCHASE_MAX_CENTS).toBe(3_000);
    expect(SMALL_PURCHASES_MIN_COUNT).toBe(5);
    expect(SUBSCRIPTION_CHANGE_DAYS).toBe(90);
    expect(TOP_COUNTERPARTY_MIN_SHARE).toBe(0.2);
    expect(MAX_INSIGHTS).toBe(3);
  });
});

describe("periodText", () => {
  it("CA3: 'este mês' no atual, o nome do mês num passado, e o ano quando é outro", () => {
    expect(periodText(NOV, TODAY)).toBe("este mês");
    expect(periodText("2026-10", TODAY)).toBe("em outubro");
    expect(periodText("2026-03", TODAY)).toBe("em março");
    expect(periodText("2025-12", TODAY)).toBe("em dezembro de 2025");
  });
});

describe("categoryInsights (regra 1)", () => {
  const period = "este mês";

  it("CA1: 25% + 1 centavo sobre a média dispara, 25% exatos não", () => {
    // Average 400,00: 25% is 100,00 (≥ 50,00, so only the ratio decides).
    expect(categoryInsights([category("Alimentação", 50_001, 40_000)], period)).toHaveLength(1);
    expect(categoryInsights([category("Alimentação", 50_000, 40_000)], period)).toEqual([]);
  });

  it("CA1: R$ 50,00 de excesso dispara, R$ 49,99 não", () => {
    // Average 100,00: 50% over it, so only the R$ 50 floor decides.
    expect(categoryInsights([category("Lazer", 15_000, 10_000)], period)).toHaveLength(1);
    expect(categoryInsights([category("Lazer", 14_999, 10_000)], period)).toEqual([]);
  });

  it("CA2: sem histórico (média null) não dispara, mesmo muito acima", () => {
    expect(categoryInsights([category("Alimentação", 900_000, null)], period)).toEqual([]);
  });

  it("CA3: o texto, a porcentagem arredondada para baixo e o impacto", () => {
    // 820,00 over 560,00: 260,00 more, 46,43% → 46%.
    const [insight] = categoryInsights([category("Alimentação", 82_000, 56_000)], period);
    expect(insight).toEqual({
      kind: "CATEGORY_ABOVE_AVERAGE",
      group: "alert",
      impactCents: 26_000,
      text: `Alimentação: ${brl(82_000)} este mês, 46% acima da média de ${brl(56_000)}.`,
      subject: { type: "category", id: "alimentação" },
    });
    expect(insight!.text).toBe("Alimentação: R$ 820,00 este mês, 46% acima da média de R$ 560,00.");
  });

  it("uma média zero dispara a partir de R$ 50,00, com outro texto", () => {
    const [insight] = categoryInsights([category("Viagem", 60_000, 0)], "em outubro");
    expect(insight?.text).toBe(
      `Viagem: ${brl(60_000)} em outubro, sem gastos nos 3 meses anteriores.`,
    );
    expect(insight?.impactCents).toBe(60_000);
    expect(categoryInsights([category("Viagem", 4_999, 0)], period)).toEqual([]);
  });

  it("'Sem categoria' e uma categoria abaixo da média não disparam", () => {
    expect(
      categoryInsights(
        [category("Sem categoria", 90_000, 10_000, null), category("Mercado", 10_000, 50_000)],
        period,
      ),
    ).toEqual([]);
  });
});

describe("smallPurchaseInsights (regra 2)", () => {
  it("CA1: 5 compras pequenas no mesmo lugar disparam, 4 não", () => {
    const five = several(5, 2_000, { counterparty: padaria });
    expect(smallPurchaseInsights(five, NOV, PERIOD)).toHaveLength(1);
    expect(smallPurchaseInsights(five.slice(1), NOV, PERIOD)).toEqual([]);
  });

  it("CA1: R$ 30,00 é pequena, R$ 30,01 não", () => {
    expect(
      smallPurchaseInsights(several(5, 3_000, { counterparty: padaria }), NOV, PERIOD),
    ).toHaveLength(1);
    const over = [
      ...several(4, 3_000, { counterparty: padaria }),
      expense("2026-11-09", 3_001, { counterparty: padaria }),
    ];
    expect(smallPurchaseInsights(over, NOV, PERIOD)).toEqual([]);
  });

  it("CA1: 5 compras somando R$ 49,99 não disparam, R$ 50,00 sim", () => {
    const at = several(5, 1_000, { counterparty: padaria });
    expect(smallPurchaseInsights(at, NOV, PERIOD)).toHaveLength(1);
    const below = [
      ...several(4, 1_000, { counterparty: padaria }),
      expense("2026-11-09", 999, { counterparty: padaria }),
    ];
    expect(smallPurchaseInsights(below, NOV, PERIOD)).toEqual([]);
  });

  it("CA3: o texto e o impacto", () => {
    const [insight] = smallPurchaseInsights(
      several(6, 2_500, { counterparty: padaria, category: cat.lanches }),
      NOV,
      PERIOD,
    );
    expect(insight).toEqual({
      kind: "SMALL_PURCHASES",
      group: "alert",
      impactCents: 15_000,
      text: `Padaria Pão Quente: 6 compras de até ${brl(3_000)} somaram ${brl(15_000)} este mês.`,
      subject: { type: "counterparty", id: "padaria" },
    });
  });

  it("depois por categoria, com as que sobraram de lugares diferentes", () => {
    const entries = [
      ...several(3, 1_500, { counterparty: padaria, category: cat.lanches }),
      ...several(3, 1_500, { counterparty: cafe, category: cat.lanches }),
    ];
    const insights = smallPurchaseInsights(entries, NOV, PERIOD);
    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({
      impactCents: 9_000,
      text: `Lanches: 6 compras de até ${brl(3_000)} somaram ${brl(9_000)} este mês.`,
      subject: { type: "category", id: "lanches" },
    });
  });

  it("CA5: uma compra não conta em dois insights", () => {
    // 5 at the bakery fire; the 4 at the café alone, in the same category, don't.
    const entries = [
      ...several(5, 2_000, { counterparty: padaria, category: cat.lanches }),
      ...several(4, 2_000, { counterparty: cafe, category: cat.lanches }),
    ];
    const insights = smallPurchaseInsights(entries, NOV, PERIOD);
    expect(insights.map((i) => i.subject)).toEqual([{ type: "counterparty", id: "padaria" }]);
  });

  it("CA5: parcelas, assinaturas, ajustes, transferências e receitas não são compras pequenas", () => {
    const entries = [
      ...several(4, 2_000, { counterparty: padaria }),
      expense("2026-11-09", 2_000, { counterparty: padaria, installment: true }),
      expense("2026-11-09", 2_000, { counterparty: padaria, subscription: true }),
      expense("2026-11-09", 2_000, { counterparty: padaria, adjustment: true }),
      expense("2026-11-09", 2_000, { counterparty: padaria, type: "TRANSFER" }),
      expense("2026-11-09", 2_000, { counterparty: padaria, type: "INCOME" }),
    ];
    expect(smallPurchaseInsights(entries, NOV, PERIOD)).toEqual([]);
  });

  it("só conta as compras do mês, e as sem lugar nem categoria ficam de fora", () => {
    const entries = [
      ...several(4, 2_000, { counterparty: padaria }),
      expense("2026-10-31", 2_000, { counterparty: padaria }),
      ...several(6, 2_000),
    ];
    expect(smallPurchaseInsights(entries, NOV, PERIOD)).toEqual([]);
  });

  it("um lugar só com compras grandes não entra", () => {
    expect(
      smallPurchaseInsights(several(9, 9_000, { counterparty: mercadoBom }), NOV, PERIOD),
    ).toEqual([]);
  });
});

describe("subscriptionRaiseInsights (regra 3)", () => {
  const raised = (changedOn: string) =>
    rule({ changes: [{ changedOn, previousCents: 3_990, amountCents: 4_490 }] });

  it("CA1: subiu há 90 dias dispara, há 91 não", () => {
    // 15/11 − 90 days = 17/08.
    expect(subscriptionRaiseInsights([raised("2026-08-17")], TODAY)).toHaveLength(1);
    expect(subscriptionRaiseInsights([raised("2026-08-16")], TODAY)).toEqual([]);
  });

  it("CA3: o texto e o impacto de um ano", () => {
    expect(subscriptionRaiseInsights([raised("2026-11-01")], TODAY)).toEqual([
      {
        kind: "SUBSCRIPTION_RAISED",
        group: "alert",
        impactCents: 6_000,
        text: `Streamflix subiu de ${brl(3_990)} para ${brl(4_490)}: ${brl(6_000)} a mais por ano.`,
        subject: { type: "subscription", id: "streamflix" },
      },
    ]);
  });

  it("CA1: uma baixa não dispara, nem um valor que voltou ao de antes", () => {
    const lowered = rule({
      amountCents: 2_990,
      changes: [{ changedOn: "2026-11-01", previousCents: 3_990, amountCents: 2_990 }],
    });
    const back = rule({
      amountCents: 3_990,
      changes: [
        { changedOn: "2026-10-01", previousCents: 3_990, amountCents: 4_490 },
        { changedOn: "2026-11-01", previousCents: 4_490, amountCents: 3_990 },
      ],
    });
    expect(subscriptionRaiseInsights([lowered, back], TODAY)).toEqual([]);
  });

  it("duas altas nos 90 dias comparam o valor de antes da primeira", () => {
    const twice = rule({
      amountCents: 4_990,
      changes: [
        { changedOn: "2026-09-01", previousCents: 3_990, amountCents: 4_490 },
        { changedOn: "2026-11-01", previousCents: 4_490, amountCents: 4_990 },
      ],
    });
    expect(subscriptionRaiseInsights([twice], TODAY)[0]?.impactCents).toBe(12_000);
  });

  it("uma assinatura pausada ou cancelada não entra", () => {
    const changes = [{ changedOn: "2026-11-01", previousCents: 3_990, amountCents: 4_490 }];
    expect(
      subscriptionRaiseInsights(
        [rule({ status: "PAUSED", changes }), rule({ status: "CANCELED", changes })],
        TODAY,
      ),
    ).toEqual([]);
  });
});

describe("subscriptionsYearlyInsight (regra 4)", () => {
  it("CA3: soma as ativas no ano, no plural e no singular", () => {
    const rules = [
      rule({ amountCents: 3_990 }),
      rule({ id: "academia", amountCents: 8_000 }),
      rule({ id: "jornal", amountCents: 2_500, status: "PAUSED" }),
    ];
    expect(subscriptionsYearlyInsight(rules)).toEqual({
      kind: "SUBSCRIPTIONS_YEARLY",
      group: "info",
      impactCents: 143_880,
      text: `Suas 2 assinaturas custam ${brl(143_880)} por ano (${brl(11_990)} por mês).`,
      subject: { type: "subscriptions" },
    });
    expect(subscriptionsYearlyInsight([rule({ amountCents: 3_990 })])?.text).toBe(
      `Sua assinatura custa ${brl(47_880)} por ano (${brl(3_990)} por mês).`,
    );
  });

  it("CA1: sem assinatura ativa não dispara", () => {
    expect(subscriptionsYearlyInsight([])).toBeNull();
    expect(subscriptionsYearlyInsight([rule({ status: "CANCELED" })])).toBeNull();
  });
});

describe("topCounterpartyInsight (regra 5)", () => {
  // The month's expenses: 1.000,00 in all.
  const rest = (cents: number) => expense("2026-11-02", cents);

  it("CA1: 20% + 1 centavo das despesas dispara, 20% exatos não", () => {
    const over = [expense("2026-11-03", 20_001, { counterparty: mercadoBom }), rest(79_999)];
    expect(topCounterpartyInsight(over, NOV, "este mês")).not.toBeNull();
    const at = [expense("2026-11-03", 20_000, { counterparty: mercadoBom }), rest(80_000)];
    expect(topCounterpartyInsight(at, NOV, "este mês")).toBeNull();
  });

  it("CA1: abaixo de R$ 50,00 não dispara, mesmo sendo tudo", () => {
    expect(
      topCounterpartyInsight(
        [expense("2026-11-03", 4_999, { counterparty: cafe })],
        NOV,
        "este mês",
      ),
    ).toBeNull();
  });

  it("CA3: o texto, as compras e a fatia arredondada para baixo", () => {
    const entries = [
      ...several(5, 10_000, { counterparty: mercadoBom }),
      expense("2026-11-28", 32_000, { counterparty: mercadoBom, installment: true }),
      expense("2026-11-04", 20_000, { counterparty: padaria }),
      rest(250_000),
      // Not in the month, and never an expense.
      expense("2026-10-03", 99_000, { counterparty: padaria }),
      expense("2026-11-03", 99_000, { counterparty: padaria, adjustment: true }),
    ];
    // 820,00 of 3.520,00: 23,29% → 23%.
    expect(topCounterpartyInsight(entries, NOV, "este mês")).toEqual({
      kind: "TOP_COUNTERPARTY",
      group: "info",
      impactCents: 82_000,
      text: `Onde você mais gastou este mês: Mercado Bom Preço, ${brl(82_000)} em 6 compras (23% das despesas).`,
      subject: { type: "counterparty", id: "mercado-bom" },
    });
  });

  it("com 1 compra diz 'em 1 compra', e um empate vai pelo nome", () => {
    const entries = [
      expense("2026-11-03", 10_000, { counterparty: padaria }),
      expense("2026-11-03", 10_000, { counterparty: cafe }),
    ];
    expect(topCounterpartyInsight(entries, NOV, "em outubro")?.text).toBe(
      `Onde você mais gastou em outubro: Café da Esquina, ${brl(10_000)} em 1 compra (50% das despesas).`,
    );
  });

  it("um mês sem despesas não dispara", () => {
    expect(topCounterpartyInsight([], NOV, "este mês")).toBeNull();
  });
});

describe("rankInsights", () => {
  const insight = (
    kind: Insight["kind"],
    group: Insight["group"],
    impactCents: number,
    text: string = kind,
  ) => ({ kind, group, impactCents, text, subject: { type: "subscriptions" } }) satisfies Insight;

  it("CA4: os alertas por impacto, depois os informativos, e só os 3 primeiros", () => {
    const ranked = rankInsights([
      insight("SUBSCRIPTIONS_YEARLY", "info", 143_880),
      insight("SMALL_PURCHASES", "alert", 9_000),
      insight("TOP_COUNTERPARTY", "info", 82_000),
      insight("CATEGORY_ABOVE_AVERAGE", "alert", 26_000),
    ]);
    expect(ranked.map((i) => i.kind)).toEqual([
      "CATEGORY_ABOVE_AVERAGE",
      "SMALL_PURCHASES",
      "SUBSCRIPTIONS_YEARLY",
    ]);
  });

  it("num empate, a ordem das regras e depois o texto", () => {
    const ranked = rankInsights([
      insight("SMALL_PURCHASES", "alert", 6_000, "b"),
      insight("SUBSCRIPTION_RAISED", "alert", 6_000),
      insight("SMALL_PURCHASES", "alert", 6_000, "a"),
      insight("CATEGORY_ABOVE_AVERAGE", "alert", 6_000),
    ]);
    expect(ranked.map((i) => [i.kind, i.text])).toEqual([
      ["CATEGORY_ABOVE_AVERAGE", "CATEGORY_ABOVE_AVERAGE"],
      ["SMALL_PURCHASES", "a"],
      ["SMALL_PURCHASES", "b"],
    ]);
  });
});

describe("monthInsights", () => {
  const entries = [
    ...several(6, 2_500, { counterparty: padaria, category: cat.lanches }),
    expense("2026-11-03", 82_000, { counterparty: mercadoBom, category: cat.mercado }),
  ];
  const categories = [category("Alimentação", 97_000, 56_000, "alimentacao")];
  const rules = [
    rule({ changes: [{ changedOn: "2026-11-01", previousCents: 3_990, amountCents: 4_490 }] }),
  ];

  it("CA4: o mês atual junta as cinco regras, ordenadas e cortadas", () => {
    const insights = monthInsights({ month: NOV, today: TODAY, entries, categories, rules })!;
    // Alerts: Alimentação +410,00, the bakery 150,00, Streamflix +60,00 a year. The infos (the
    // year of subscriptions, the market) don't fit.
    expect(insights.map((i) => [i.kind, i.impactCents])).toEqual([
      ["CATEGORY_ABOVE_AVERAGE", 41_000],
      ["SMALL_PURCHASES", 15_000],
      ["SUBSCRIPTION_RAISED", 6_000],
    ]);
  });

  it("um mês passado não tem as regras de assinatura e fala 'em outubro'", () => {
    const october = entries.map((e) => ({ ...e, date: e.date.replace("2026-11", "2026-10") }));
    const insights = monthInsights({
      month: "2026-10",
      today: TODAY,
      entries: october,
      categories,
      rules,
    })!;
    expect(insights.map((i) => i.kind)).toEqual([
      "CATEGORY_ABOVE_AVERAGE",
      "SMALL_PURCHASES",
      "TOP_COUNTERPARTY",
    ]);
    expect(insights.every((i) => i.text.includes("em outubro"))).toBe(true);
  });

  it("CA4: um mês futuro não tem insights", () => {
    expect(
      monthInsights({ month: "2026-12", today: TODAY, entries, categories, rules }),
    ).toBeNull();
  });

  it("sem nada que dispare, a lista vem vazia", () => {
    expect(
      monthInsights({ month: NOV, today: TODAY, entries: [], categories: [], rules: [] }),
    ).toEqual([]);
  });
});
