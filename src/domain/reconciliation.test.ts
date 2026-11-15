import { describe, expect, it } from "vitest";

import { adjustmentFor, reconciliationDiff } from "./reconciliation";

describe("reconciliationDiff", () => {
  it("CA1: the bank has less: an expense is missing", () => {
    expect(reconciliationDiff(123_456, 120_000)).toEqual({
      diffCents: -3_456,
      direction: "MISSING_EXPENSE",
    });
  });

  it("CA1: the bank has more: an income is missing", () => {
    expect(reconciliationDiff(120_000, 123_456)).toEqual({
      diffCents: 3_456,
      direction: "MISSING_INCOME",
    });
  });

  it("CA1: equal balances match, negative ones included", () => {
    expect(reconciliationDiff(0, 0)).toEqual({ diffCents: 0, direction: "MATCH" });
    expect(reconciliationDiff(-12_000, -12_000)).toEqual({ diffCents: 0, direction: "MATCH" });
  });

  it("CA1: with an overdraft", () => {
    expect(reconciliationDiff(5_000, -1_000)).toEqual({
      diffCents: -6_000,
      direction: "MISSING_EXPENSE",
    });
    expect(reconciliationDiff(-5_000, -1_000)).toEqual({
      diffCents: 4_000,
      direction: "MISSING_INCOME",
    });
  });
});

describe("adjustmentFor", () => {
  it("an expense when the bank has less, an income when it has more; nothing when it matches", () => {
    expect(adjustmentFor(-3_456)).toEqual({ type: "EXPENSE", amountCents: 3_456 });
    expect(adjustmentFor(3_456)).toEqual({ type: "INCOME", amountCents: 3_456 });
    expect(adjustmentFor(0)).toBeNull();
  });
});
