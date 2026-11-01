import { describe, expect, it } from "vitest";

import { defaultPayment, topCategories } from "./register";

describe("topCategories", () => {
  // Selectable expense categories, flat (parents and children).
  const categories = [
    { id: "moradia", parentId: null, name: "Moradia" },
    { id: "alimentacao", parentId: null, name: "Alimentação" },
    { id: "mercado", parentId: "alimentacao", name: "Mercado" },
    { id: "padaria", parentId: "alimentacao", name: "Padaria e lanches" },
    { id: "transporte", parentId: null, name: "Transporte" },
    { id: "saude", parentId: null, name: "Saúde" },
    { id: "lazer", parentId: null, name: "Lazer" },
    { id: "pets", parentId: null, name: "Pets" }, // created by the user: not in the default list
  ];
  const defaultOrder = ["Moradia", "Alimentação", "Transporte", "Saúde", "Lazer"];
  const at = (day: number) => new Date(Date.UTC(2026, 9, day));

  it("without usage, the parents in the default list's order, then the others alphabetically", () => {
    expect(topCategories([], categories, defaultOrder, 6).map((c) => c.id)).toEqual([
      "moradia",
      "alimentacao",
      "transporte",
      "saude",
      "lazer",
      "pets",
    ]);
  });

  it("most used first; ties go to the most recent; then fills with the defaults", () => {
    const usage = [
      { categoryId: "padaria", count: 2, lastUsedAt: at(10) },
      { categoryId: "mercado", count: 5, lastUsedAt: at(1) },
      { categoryId: "pets", count: 2, lastUsedAt: at(20) },
    ];
    expect(topCategories(usage, categories, defaultOrder).map((c) => c.id)).toEqual([
      "mercado",
      "pets",
      "padaria",
      "moradia",
      "alimentacao",
    ]);
  });

  it("leaves out usage of categories that aren't selectable (archived or another type)", () => {
    const usage = [{ categoryId: "arquivada", count: 50, lastUsedAt: at(30) }];
    expect(topCategories(usage, categories, defaultOrder, 2).map((c) => c.id)).toEqual([
      "moradia",
      "alimentacao",
    ]);
  });

  it("returns fewer when there are fewer categories", () => {
    expect(topCategories([], categories.slice(0, 2), defaultOrder)).toHaveLength(2);
  });

  it("matches default names regardless of case and accents", () => {
    const renamed = [
      { id: "a", parentId: null, name: "Zebra" },
      { id: "b", parentId: null, name: "saude" },
    ];
    expect(topCategories([], renamed, defaultOrder).map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("defaultPayment", () => {
  const accounts = [{ id: "azul" }, { id: "inter" }];
  const cards = [{ id: "roxo" }, { id: "preto" }];
  const none = { method: null, accountId: null, cardId: null };

  it("without history: Pix on the first account, the first card remembered for credit", () => {
    expect(defaultPayment("EXPENSE", none, accounts, cards)).toEqual({
      method: "PIX",
      accountId: "azul",
      cardId: "roxo",
    });
  });

  it("repeats the last method, account and card", () => {
    expect(
      defaultPayment(
        "EXPENSE",
        { method: "DEBIT", accountId: "inter", cardId: "preto" },
        accounts,
        cards,
      ),
    ).toEqual({ method: "DEBIT", accountId: "inter", cardId: "preto" });
    expect(
      defaultPayment(
        "EXPENSE",
        { method: "CREDIT", accountId: "inter", cardId: "preto" },
        accounts,
        cards,
      ),
    ).toEqual({ method: "CREDIT", accountId: "inter", cardId: "preto" });
  });

  it("an archived account or card falls back to the first active one", () => {
    expect(
      defaultPayment(
        "EXPENSE",
        { method: "DEBIT", accountId: "velha", cardId: "velho" },
        accounts,
        cards,
      ),
    ).toEqual({ method: "DEBIT", accountId: "azul", cardId: "roxo" });
  });

  it("credit without any active card falls back to Pix", () => {
    expect(
      defaultPayment(
        "EXPENSE",
        { method: "CREDIT", accountId: "inter", cardId: "velho" },
        accounts,
        [],
      ),
    ).toEqual({ method: "PIX", accountId: "inter", cardId: null });
  });

  it("an income never starts on credit or debit", () => {
    expect(
      defaultPayment(
        "INCOME",
        { method: "TED", accountId: "inter", cardId: null },
        accounts,
        cards,
      ),
    ).toEqual({ method: "TED", accountId: "inter", cardId: "roxo" });
    expect(
      defaultPayment(
        "INCOME",
        { method: "DEBIT", accountId: "inter", cardId: null },
        accounts,
        cards,
      ),
    ).toMatchObject({ method: "PIX" });
  });

  it("no active account: nothing to register on", () => {
    expect(defaultPayment("EXPENSE", none, [], cards)).toBeNull();
  });
});
