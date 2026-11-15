import { describe, expect, it } from "vitest";

import {
  type RuleEditInput,
  nextChargeDate,
  recentChange,
  subscriptionTotals,
  validateRuleEdit,
} from "./subscriptions";

describe("subscriptionTotals", () => {
  it("CA1: the active ones per month, × 12 per year; paused and canceled stay out", () => {
    expect(
      subscriptionTotals([
        { status: "ACTIVE", amountCents: 3_990 },
        { status: "ACTIVE", amountCents: 12_000 },
        { status: "PAUSED", amountCents: 5_000 },
        { status: "CANCELED", amountCents: 9_990 },
      ]),
    ).toEqual({ monthlyCents: 15_990, yearlyCents: 15_990 * 12, count: 2 });
  });

  it("nothing active: zero", () => {
    expect(subscriptionTotals([])).toEqual({ monthlyCents: 0, yearlyCents: 0, count: 0 });
  });
});

describe("recentChange", () => {
  const today = "2026-11-15";
  const change = (changedOn: string, previousCents: number, amountCents: number) => ({
    changedOn,
    previousCents,
    amountCents,
  });

  it("CA2: up or down, with the previous amount and the day", () => {
    expect(recentChange([change("2026-11-05", 3_490, 3_990)], 3_990, today)).toEqual({
      previousCents: 3_490,
      direction: "up",
      changedOn: "2026-11-05",
    });
    expect(recentChange([change("2026-11-05", 3_990, 2_990)], 2_990, today)).toMatchObject({
      direction: "down",
    });
  });

  it("CA2: up to 90 days after the change", () => {
    expect(recentChange([change("2026-08-17", 3_490, 3_990)], 3_990, today)).not.toBeNull();
    expect(recentChange([change("2026-08-16", 3_490, 3_990)], 3_990, today)).toBeNull();
  });

  it("CA2: with two changes, the amount before the first one and the day of the last", () => {
    expect(
      recentChange(
        [change("2026-09-01", 3_490, 3_990), change("2026-10-01", 3_990, 4_490)],
        4_490,
        today,
      ),
    ).toEqual({ previousCents: 3_490, direction: "up", changedOn: "2026-10-01" });
  });

  it("changed back to the same amount: nothing to show", () => {
    expect(
      recentChange(
        [change("2026-09-01", 3_490, 3_990), change("2026-10-01", 3_990, 3_490)],
        3_490,
        today,
      ),
    ).toBeNull();
    expect(recentChange([], 3_490, today)).toBeNull();
  });
});

describe("nextChargeDate", () => {
  it("CA3: the rule's day in the cursor's month, the last day when the month lacks it", () => {
    expect(nextChargeDate({ dayOfMonth: 31, nextMonth: "2027-02" })).toBe("2027-02-28");
    expect(nextChargeDate({ dayOfMonth: 31, nextMonth: "2028-02" })).toBe("2028-02-29");
    expect(nextChargeDate({ dayOfMonth: 8, nextMonth: "2026-12" })).toBe("2026-12-08");
  });
});

describe("validateRuleEdit", () => {
  const archived = new Date("2026-10-01T12:00:00Z");
  const refs = {
    accounts: [
      { id: "azul", archivedAt: null },
      { id: "antiga", archivedAt: archived },
    ],
    cards: [
      {
        id: "roxo",
        archivedAt: null,
        cycles: [{ closingDay: 3, dueDay: 10, validFrom: "1900-01-01" }],
      },
    ],
    categories: [
      { id: "lazer", type: "EXPENSE" as const, archivedAt: null, parent: null },
      { id: "salario", type: "INCOME" as const, archivedAt: null, parent: null },
    ],
  };
  const edit = (over: Partial<RuleEditInput> = {}): RuleEditInput => ({
    amountCents: 3_990,
    dayOfMonth: 8,
    method: "PIX",
    accountId: "azul",
    cardId: null,
    categoryId: "lazer",
    description: null,
    ...over,
  });
  const current = { accountId: "azul", cardId: null, categoryId: "lazer" };
  const today = "2026-11-15";

  it("CA4: like a new expense: a card, an account, an expense category", () => {
    expect(validateRuleEdit(edit(), refs, current, today)).toEqual({ ok: true });
    expect(
      validateRuleEdit(
        edit({ method: "CREDIT", accountId: null, cardId: "roxo" }),
        refs,
        current,
        today,
      ),
    ).toEqual({ ok: true });
    expect(validateRuleEdit(edit({ categoryId: "salario" }), refs, current, today)).toEqual({
      ok: false,
      error: "CATEGORY_TYPE_MISMATCH",
    });
    expect(validateRuleEdit(edit({ accountId: "outra" }), refs, current, today)).toEqual({
      ok: false,
      error: "ACCOUNT_NOT_FOUND",
    });
  });

  it("an archived account may stay only when the rule already had it", () => {
    expect(validateRuleEdit(edit({ accountId: "antiga" }), refs, current, today)).toEqual({
      ok: false,
      error: "ACCOUNT_ARCHIVED",
    });
    expect(
      validateRuleEdit(
        edit({ accountId: "antiga" }),
        refs,
        { ...current, accountId: "antiga" },
        today,
      ),
    ).toEqual({ ok: true });
  });
});
