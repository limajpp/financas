import { describe, expect, it } from "vitest";

import { cycleChange, sortCards, validateCard } from "./cards";

const cards = [
  { id: "c1", name: "Cartão Roxo" },
  { id: "c2", name: "Cartão Antigo" },
];
const accounts = [
  { id: "a1", archivedAt: null },
  { id: "a2", archivedAt: new Date() },
];

describe("validateCard", () => {
  it("accepts a new card on an active account", () => {
    expect(validateCard({ name: "Cartão Azul", accountId: "a1" }, cards, accounts)).toEqual({
      ok: true,
    });
  });

  it("refuses a repeated name regardless of case and accents", () => {
    expect(validateCard({ name: "cartao roxo", accountId: "a1" }, cards, accounts)).toEqual({
      ok: false,
      error: "DUPLICATE_NAME",
    });
    expect(
      validateCard({ id: "c1", name: "CARTÃO ROXO", accountId: "a1" }, cards, accounts),
    ).toEqual({ ok: true });
  });

  it("refuses an account outside the space, and an archived one for a new choice", () => {
    expect(validateCard({ name: "X", accountId: "other" }, cards, accounts)).toEqual({
      ok: false,
      error: "ACCOUNT_NOT_FOUND",
    });
    expect(validateCard({ name: "X", accountId: "a2" }, cards, accounts)).toEqual({
      ok: false,
      error: "ACCOUNT_ARCHIVED",
    });
    expect(
      validateCard(
        { id: "c1", name: "Cartão Roxo", accountId: "a2", currentAccountId: "a1" },
        cards,
        accounts,
      ),
    ).toEqual({ ok: false, error: "ACCOUNT_ARCHIVED" });
  });

  it("an edited card may keep the account it already had, even if archived since", () => {
    expect(
      validateCard(
        { id: "c1", name: "Cartão Roxo", accountId: "a2", currentAccountId: "a2" },
        cards,
        accounts,
      ),
    ).toEqual({ ok: true });
  });
});

describe("cycleChange", () => {
  it("returns a version starting today only when the days change", () => {
    const current = { closingDay: 5, dueDay: 12 };
    expect(cycleChange(current, { closingDay: 5, dueDay: 12 }, "2026-10-31")).toBeNull();
    expect(cycleChange(current, { closingDay: 20, dueDay: 12 }, "2026-10-31")).toEqual({
      closingDay: 20,
      dueDay: 12,
      validFrom: "2026-10-31",
    });
    expect(cycleChange(current, { closingDay: 5, dueDay: 13 }, "2026-10-31")).not.toBeNull();
  });
});

describe("sortCards", () => {
  it("sorts in pt-BR order", () => {
    expect(sortCards(cards).map((c) => c.name)).toEqual(["Cartão Antigo", "Cartão Roxo"]);
  });
});
