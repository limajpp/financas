import { describe, expect, it } from "vitest";

import { addAlias, MAX_ALIASES, resolveCounterparty, suggestionFor } from "./counterparty-memory";

const at = (day: number) => new Date(Date.UTC(2026, 9, day));

describe("suggestionFor", () => {
  const active = new Set(["mercado", "padaria", "lazer"]);
  const none = { defaultCategoryId: null, defaultDescription: null, lastDescription: null };

  it("the most used category; ties go to the most recent", () => {
    expect(
      suggestionFor(
        {
          ...none,
          categoryUsage: [
            { categoryId: "padaria", count: 2, lastUsedAt: at(1) },
            { categoryId: "mercado", count: 5, lastUsedAt: at(2) },
          ],
        },
        active,
      ).categoryId,
    ).toBe("mercado");
    expect(
      suggestionFor(
        {
          ...none,
          categoryUsage: [
            { categoryId: "padaria", count: 2, lastUsedAt: at(1) },
            { categoryId: "lazer", count: 2, lastUsedAt: at(9) },
          ],
        },
        active,
      ).categoryId,
    ).toBe("lazer");
  });

  it("never an archived (or other type's) category: the next one, or none", () => {
    const usage = [
      { categoryId: "arquivada", count: 9, lastUsedAt: at(9) },
      { categoryId: "padaria", count: 1, lastUsedAt: at(1) },
    ];
    expect(suggestionFor({ ...none, categoryUsage: usage }, active).categoryId).toBe("padaria");
    expect(suggestionFor({ ...none, categoryUsage: usage.slice(0, 1) }, active).categoryId).toBe(
      null,
    );
  });

  it("an explicit default wins while it's active", () => {
    const usage = [{ categoryId: "mercado", count: 9, lastUsedAt: at(9) }];
    expect(
      suggestionFor({ ...none, defaultCategoryId: "lazer", categoryUsage: usage }, active)
        .categoryId,
    ).toBe("lazer");
    expect(
      suggestionFor({ ...none, defaultCategoryId: "arquivada", categoryUsage: usage }, active)
        .categoryId,
    ).toBe("mercado");
  });

  it("the description: the explicit default, else the most recent one", () => {
    expect(
      suggestionFor({ ...none, categoryUsage: [], lastDescription: "Pão e café" }, active)
        .description,
    ).toBe("Pão e café");
    expect(
      suggestionFor(
        { ...none, categoryUsage: [], defaultDescription: "Pão", lastDescription: "Bolo" },
        active,
      ).description,
    ).toBe("Pão");
  });
});

describe("addAlias", () => {
  it("appends a new alias", () => {
    expect(addAlias(["PAG*JOSE"], "PIX MARIA")).toEqual(["PAG*JOSE", "PIX MARIA"]);
  });

  it("ignores one already there, regardless of case and accents; trims", () => {
    expect(addAlias(["Padaria São João"], "  padaria sao joao ")).toEqual(["Padaria São João"]);
  });

  it(`keeps at most ${MAX_ALIASES}: the oldest goes`, () => {
    const full = Array.from({ length: MAX_ALIASES }, (_, i) => `A${i}`);
    expect(addAlias(full, "NOVO")).toEqual([...full.slice(1), "NOVO"]);
  });

  it("an empty alias changes nothing", () => {
    expect(addAlias(["X"], "   ")).toEqual(["X"]);
  });
});

describe("resolveCounterparty", () => {
  const list = [
    { id: "padaria", name: "Padaria São João", aliases: ["PAG*JOSE SILVA"], document: null },
    { id: "mercado", name: "Mercado", aliases: [], document: "11222333000181" },
    { id: "pag1", name: "Loja 1", aliases: ["PAGSEGURO"], document: "12345678000195" },
    { id: "pag2", name: "Loja 2", aliases: ["pagseguro"], document: "12345678000195" },
  ];

  it("by name first, ignoring case and accents", () => {
    expect(resolveCounterparty("padaria sao joao", list)).toBe("padaria");
  });

  it("by the exact alias or document of a single counterparty", () => {
    expect(resolveCounterparty("pag*jose silva", list)).toBe("padaria");
    expect(resolveCounterparty("11.222.333/0001-81", list)).toBe("mercado");
  });

  it("not when two share that alias or document, nor on a partial match", () => {
    expect(resolveCounterparty("PAGSEGURO", list)).toBeNull();
    expect(resolveCounterparty("12.345.678/0001-95", list)).toBeNull();
    expect(resolveCounterparty("PAG*JOSE", list)).toBeNull();
    expect(resolveCounterparty("Padaria", list)).toBeNull();
  });
});
