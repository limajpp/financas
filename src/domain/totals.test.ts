import { describe, expect, it } from "vitest";

import { type TotalsEntry, incomeByCategory, spendingByCategory } from "./totals";

const entry = (overrides: Partial<TotalsEntry>): TotalsEntry => ({
  type: "EXPENSE",
  amountCents: 1_000,
  categoryId: "mercado",
  adjustment: false,
  ...overrides,
});

describe("spendingByCategory / incomeByCategory", () => {
  const entries = [
    entry({ amountCents: 1_000 }),
    entry({ amountCents: 2_500 }), // a credit purchase counts like any expense
    entry({ categoryId: null, amountCents: 300 }),
    entry({ type: "INCOME", categoryId: "salario", amountCents: 500_000 }),
    // A refund on the card is an income on credit (task 18): it counts as income.
    entry({ type: "INCOME", categoryId: "reembolsos", amountCents: 8_990 }),
    entry({ type: "TRANSFER", categoryId: null, amountCents: 20_000 }),
    entry({ type: "CARD_PAYMENT", categoryId: null, amountCents: 3_500 }),
    // Even with a category (the database never has one), these are never spending or income.
    entry({ type: "TRANSFER", categoryId: "mercado", amountCents: 99 }),
    entry({ type: "CARD_PAYMENT", categoryId: "salario", amountCents: 99 }),
    // Balance adjustments (task 21's CA2) are never spending or income either.
    entry({ categoryId: null, amountCents: 777, adjustment: true }),
    entry({ type: "INCOME", categoryId: null, amountCents: 888, adjustment: true }),
  ];

  it("CA2: sums expenses per category, without transfers or invoice payments", () => {
    expect(spendingByCategory(entries)).toEqual(
      new Map([
        ["mercado", 3_500],
        [null, 300],
      ]),
    );
  });

  it("CA2 and task 18's CA5: sums income per category (refunds included), without transfers or invoice payments", () => {
    expect(incomeByCategory(entries)).toEqual(
      new Map([
        ["salario", 500_000],
        ["reembolsos", 8_990],
      ]),
    );
  });
});
