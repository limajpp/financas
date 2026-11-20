import { describe, expect, it } from "vitest";

import { ongoingPurchaseSchema, openingBalanceSchema, subscriptionRuleSchema } from "./onboarding";

const card = "0190a8e2-0000-7000-8000-000000000001";
const client = "0190a8e2-0000-7000-8000-000000000002";

describe("openingBalanceSchema", () => {
  it("aceita zero (apaga) e recusa negativo e data inválida", () => {
    expect(
      openingBalanceSchema.parse({ cardId: card, dueDate: "2026-12-10", amountCents: 0 }),
    ).toEqual({ cardId: card, dueDate: "2026-12-10", amountCents: 0 });
    expect(
      openingBalanceSchema.safeParse({ cardId: card, dueDate: "2026-12-10", amountCents: -1 })
        .success,
    ).toBe(false);
    expect(
      openingBalanceSchema.safeParse({ cardId: card, dueDate: "10/12", amountCents: 1 }).success,
    ).toBe(false);
  });
});

describe("ongoingPurchaseSchema", () => {
  const base = { clientId: client, cardId: card, current: 3, total: 10, amountCents: 15_000 };

  it("campos em branco viram nada", () => {
    expect(ongoingPurchaseSchema.parse({ ...base, counterparty: " ", categoryId: "" })).toEqual({
      clientId: client,
      input: {
        cardId: card,
        counterparty: null,
        categoryId: null,
        current: 3,
        total: 10,
        amountCents: 15_000,
      },
    });
  });

  it("pede a parcela atual, o total e um valor", () => {
    const issue = (input: object) =>
      ongoingPurchaseSchema.safeParse({ ...base, ...input }).error?.issues[0]?.message;
    expect(issue({ current: 0 })).toBe("Informe a parcela atual.");
    expect(issue({ total: 0 })).toBe("Informe o total de parcelas.");
    expect(issue({ amountCents: 0 })).toBe("O valor precisa ser maior que zero.");
  });
});

describe("subscriptionRuleSchema", () => {
  const rule = {
    amountCents: 3_990,
    dayOfMonth: 8,
    method: "CREDIT",
    accountId: card,
    cardId: card,
    categoryId: "",
    description: null,
  };

  it("junta o nome à regra; crédito fica só com o cartão", () => {
    expect(subscriptionRuleSchema.parse({ counterparty: " Streaming ", rule })).toEqual({
      counterparty: "Streaming",
      amountCents: 3_990,
      dayOfMonth: 8,
      method: "CREDIT",
      accountId: null,
      cardId: card,
      categoryId: null,
      description: null,
    });
  });

  it("pede o nome e o dia", () => {
    expect(
      subscriptionRuleSchema.safeParse({ counterparty: "", rule }).error?.issues[0]?.message,
    ).toBe("Informe o que é a assinatura.");
    expect(
      subscriptionRuleSchema.safeParse({ counterparty: "X", rule: { ...rule, dayOfMonth: 0 } })
        .error?.issues[0]?.message,
    ).toBe("Escolha um dia de 1 a 31.");
  });
});
