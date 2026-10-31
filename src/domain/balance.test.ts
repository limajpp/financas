import { describe, expect, it } from "vitest";

import { type BalanceEntry, accountBalance } from "./balance";

const azul = { id: "azul", initialBalanceCents: 100_000, initialBalanceDate: "2026-10-10" };

function entry(overrides: Partial<BalanceEntry>): BalanceEntry {
  return {
    type: "EXPENSE",
    method: "PIX",
    amountCents: 1_000,
    date: "2026-10-15",
    accountId: "azul",
    toAccountId: null,
    ...overrides,
  };
}

const asOf = "2026-10-31";

describe("accountBalance", () => {
  it("starts from the initial balance", () => {
    expect(accountBalance(azul, [], asOf)).toBe(100_000);
  });

  it("adds income and subtracts Pix, debit, cash, boleto and TED expenses", () => {
    const entries = [
      entry({ type: "INCOME", method: "TED", amountCents: 50_000 }),
      entry({ method: "PIX", amountCents: 1_000 }),
      entry({ method: "DEBIT", amountCents: 2_000 }),
      entry({ method: "CASH", amountCents: 300 }),
      entry({ method: "BOLETO", amountCents: 4_000 }),
      entry({ method: "TED", amountCents: 500 }),
    ];
    expect(accountBalance(azul, entries, asOf)).toBe(100_000 + 50_000 - 7_800);
  });

  it("a credit purchase does not change the balance; paying the invoice does", () => {
    // Credit purchases point to the card, not the account; even one that names the account
    // (which the database refuses) doesn't count.
    const purchase = entry({ method: "CREDIT", amountCents: 30_000, accountId: null });
    const odd = entry({ method: "CREDIT", amountCents: 30_000 });
    expect(accountBalance(azul, [purchase, odd], asOf)).toBe(100_000);

    const payment = entry({ type: "CARD_PAYMENT", method: "PIX", amountCents: 30_000 });
    expect(accountBalance(azul, [purchase, payment], asOf)).toBe(70_000);
  });

  it("a transfer leaves the origin and enters the destination", () => {
    const transfer = entry({
      type: "TRANSFER",
      method: "PIX",
      amountCents: 20_000,
      accountId: "azul",
      toAccountId: "verde",
    });
    const verde = { id: "verde", initialBalanceCents: 0, initialBalanceDate: "2026-10-01" };
    expect(accountBalance(azul, [transfer], asOf)).toBe(80_000);
    expect(accountBalance(verde, [transfer], asOf)).toBe(20_000);
  });

  it("ignores other accounts' entries", () => {
    const entries = [
      entry({ accountId: "verde" }),
      entry({ type: "INCOME", accountId: "verde" }),
      entry({ type: "TRANSFER", accountId: "verde", toAccountId: "roxo" }),
    ];
    expect(accountBalance(azul, entries, asOf)).toBe(100_000);
  });

  it("counts only entries after the initial balance day, up to asOf inclusive", () => {
    const entries = [
      entry({ date: "2026-10-09", amountCents: 1 }), // before: already in the initial balance
      entry({ date: "2026-10-10", amountCents: 10 }), // same day: the initial balance is end of day
      entry({ date: "2026-10-11", amountCents: 100 }), // the day after: counts
      entry({ date: "2026-10-31", amountCents: 1_000 }), // asOf: counts
      entry({ date: "2026-11-01", amountCents: 10_000 }), // after asOf: not yet
    ];
    expect(accountBalance(azul, entries, asOf)).toBe(100_000 - 1_100);
  });

  it("can go negative", () => {
    expect(accountBalance(azul, [entry({ amountCents: 150_000 })], asOf)).toBe(-50_000);
  });
});
