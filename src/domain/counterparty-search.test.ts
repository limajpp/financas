import { describe, expect, it } from "vitest";

import { type SearchableCounterparty, searchCounterparties } from "./counterparty-search";

const day = (n: number) => Date.UTC(2026, 9, n);

function cp(
  id: string,
  name: string,
  extra: Partial<SearchableCounterparty> = {},
): SearchableCounterparty {
  return {
    id,
    name,
    aliases: [],
    document: null,
    useCount: 1,
    recentCount: 1,
    lastUsedAt: day(1),
    ...extra,
  };
}

const list = [
  cp("padaria", "Padaria São João", { useCount: 3 }),
  cp("mercado", "Mercado Central", {
    aliases: ["PAG*JOSE SILVA 12.345.678/0001-95"],
    useCount: 10,
  }),
  cp("feira", "Feira da Praça", { document: "11222333000181", useCount: 2 }),
  cp("loja", "Loja Nova", { document: "12ABC34501DE35" }),
  cp("academia", "Academia", { document: "52998224725" }),
];

const ids = (query: string, limit?: number) =>
  searchCounterparties(query, list, limit).map((r) => r.counterparty.id);

describe("searchCounterparties", () => {
  it("CA2: ignores accents, case and extra spaces in names", () => {
    expect(ids("padaria sao  joao")).toEqual(["padaria"]);
    expect(ids("PRAÇA")).toEqual(["feira"]);
    expect(ids("joão")).toEqual(["padaria"]);
  });

  it("CA2: finds by any part of an alias, ignoring case", () => {
    expect(searchCounterparties("jose", list)).toEqual([
      {
        counterparty: list[1],
        match: { field: "alias", text: "PAG*JOSE SILVA 12.345.678/0001-95" },
      },
    ]);
  });

  it("CA1: finds by part of a CNPJ, with or without punctuation", () => {
    for (const query of ["222.333", "222333", "11.222.333/0001-81", "11222333000181"]) {
      expect(searchCounterparties(query, list)).toEqual([
        { counterparty: list[2], match: { field: "document", text: "11.222.333/0001-81" } },
      ]);
    }
  });

  it("CA1: finds an alphanumeric CNPJ, a CPF, and digits inside an alias", () => {
    expect(ids("abc.345")).toEqual(["loja"]);
    expect(ids("982.247")).toEqual(["academia"]);
    expect(ids("345.678/0001")).toEqual(["mercado"]);
  });

  it("needs at least 3 digits to search documents", () => {
    expect(ids("22")).toEqual([]);
  });

  it("CA2: starts-with before contains, name before alias before document; then most used", () => {
    const ranked = [
      cp("doc", "Zeta", { document: "12345678000195", useCount: 100 }),
      cp("alias-start", "Beta", { aliases: ["123 Rua"], useCount: 50 }),
      cp("name-contains", "Bar 123", { useCount: 40 }),
      cp("name-start-less", "123 Lanches", { useCount: 1 }),
      cp("name-start-more", "123 Burger", { useCount: 5 }),
    ];
    expect(searchCounterparties("123", ranked).map((r) => r.counterparty.id)).toEqual([
      "name-start-more",
      "name-start-less",
      "alias-start",
      "name-contains",
      "doc",
    ]);
  });

  it("ties on use go to the most recently used", () => {
    const tied = [
      cp("old", "Bar Velho", { lastUsedAt: day(1) }),
      cp("new", "Bar Novo", { lastUsedAt: day(20) }),
    ];
    expect(searchCounterparties("bar", tied).map((r) => r.counterparty.id)).toEqual(["new", "old"]);
  });

  it("respects the limit", () => {
    expect(ids("a", 2)).toHaveLength(2);
  });

  it("an empty query lists the most used in the last 90 days", () => {
    const recent = [
      cp("a", "A", { recentCount: 1, lastUsedAt: day(30) }),
      cp("b", "B", { recentCount: 7 }),
      cp("c", "C", { recentCount: 0, useCount: 99 }),
      cp("d", "D", { recentCount: 3 }),
    ];
    expect(searchCounterparties("  ", recent, 3).map((r) => r.counterparty.id)).toEqual([
      "b",
      "d",
      "a",
    ]);
    expect(searchCounterparties("", recent)[0]?.match).toEqual({ field: "name", text: "B" });
  });

  it("a query of punctuation only finds nothing", () => {
    expect(ids("./-")).toEqual([]);
  });
});
