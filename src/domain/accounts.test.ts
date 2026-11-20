import { describe, expect, it } from "vitest";

import { type AccountNode, selectableAccountList, sortAccounts, validateAccount } from "./accounts";

const account = (id: string, name: string, archived = false): AccountNode => ({
  id,
  name,
  archivedAt: archived ? new Date() : null,
});

const today = "2026-10-31";

describe("validateAccount", () => {
  const existing = [account("a", "Banco Azul"), account("b", "Corretora", true)];

  it("accepts a new name and today or a past date", () => {
    expect(
      validateAccount({ name: "Carteira", initialBalanceDate: today }, existing, today),
    ).toEqual({ ok: true });
    expect(
      validateAccount({ name: "Carteira", initialBalanceDate: "2025-01-01" }, existing, today),
    ).toEqual({ ok: true });
  });

  it("refuses a repeated name regardless of case and accents, archived included", () => {
    expect(
      validateAccount({ name: "banco azul", initialBalanceDate: today }, existing, today),
    ).toEqual({ ok: false, error: "DUPLICATE_NAME" });
    expect(
      validateAccount({ name: "CORRETÓRA", initialBalanceDate: today }, existing, today),
    ).toEqual({ ok: false, error: "DUPLICATE_NAME" });
  });

  it("lets an account keep its own name when edited", () => {
    expect(
      validateAccount({ id: "a", name: "BANCO AZUL", initialBalanceDate: today }, existing, today),
    ).toEqual({ ok: true });
  });

  it("refuses a date after today", () => {
    expect(
      validateAccount({ name: "Carteira", initialBalanceDate: "2026-11-01" }, existing, today),
    ).toEqual({ ok: false, error: "FUTURE_DATE" });
  });
});

describe("ordering and picker", () => {
  it("sorts in pt-BR order and leaves archived accounts out of the picker", () => {
    const list = [account("1", "Ônibus"), account("2", "Banco"), account("3", "Antiga", true)];
    expect(sortAccounts(list).map((a) => a.name)).toEqual(["Antiga", "Banco", "Ônibus"]);
    expect(selectableAccountList(list).map((a) => a.name)).toEqual(["Banco", "Ônibus"]);
  });
});
