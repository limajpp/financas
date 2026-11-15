import { describe, expect, it } from "vitest";

import {
  averageTicket,
  cleanAliases,
  mergeMemory,
  periodRange,
  rankCounterparties,
} from "./counterparties";

describe("periodRange", () => {
  const today = "2026-11-15";
  it("this month, last month, the last 3 months (this one and the 2 before) and this year", () => {
    expect(periodRange("mes", today)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(periodRange("mes-passado", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("3-meses", today)).toEqual({ from: "2026-09-01", to: "2026-11-30" });
    expect(periodRange("ano", today)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("crosses the year back", () => {
    expect(periodRange("mes-passado", "2027-01-10")).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
    expect(periodRange("3-meses", "2027-02-28")).toEqual({ from: "2026-12-01", to: "2027-02-28" });
  });
});

describe("rankCounterparties", () => {
  const row = (name: string, totalCents: number, purchases: number) => ({
    id: name,
    name,
    totalCents,
    purchases,
  });
  const rows = [
    row("Padaria", 12_000, 20),
    row("Mercado", 80_000, 6),
    row("Farmácia", 12_000, 3),
    row("Academia", 12_000, 3),
    row("Posto", 30_000, 20),
  ];

  it("CA1: by value, ties by purchases, then by name", () => {
    expect(rankCounterparties(rows, "value").map((r) => r.name)).toEqual([
      "Mercado",
      "Posto",
      "Padaria",
      "Academia",
      "Farmácia",
    ]);
  });

  it("CA1: by frequency, ties by value, then by name", () => {
    expect(rankCounterparties(rows, "frequency").map((r) => r.name)).toEqual([
      "Posto",
      "Padaria",
      "Mercado",
      "Academia",
      "Farmácia",
    ]);
  });
});

describe("averageTicket", () => {
  it("the total over the purchases, to the cent; none without purchases", () => {
    expect(averageTicket(10_000, 3)).toBe(3_333);
    expect(averageTicket(10_001, 2)).toBe(5_001);
    expect(averageTicket(0, 0)).toBeNull();
  });
});

describe("cleanAliases", () => {
  it("drops blanks, repeats and the name itself, without case and accents", () => {
    expect(
      cleanAliases("Padaria São João", [
        " PAG*PADARIA ",
        "pag*padaria",
        "",
        "padaria sao joao",
        "PADARIA SJ",
      ]),
    ).toEqual(["PAG*PADARIA", "PADARIA SJ"]);
  });
});

describe("mergeMemory", () => {
  const keep = {
    name: "Padaria do bairro",
    aliases: ["PAG*PADARIA"],
    document: null,
    defaultCategoryId: "padaria",
    defaultDescription: null,
  };
  const absorbed = {
    name: "Padaria Sao Joao",
    aliases: ["pag*padaria", "PADARIA SJ"],
    document: "12345678000190",
    defaultCategoryId: "outros",
    defaultDescription: "Pão",
  };

  it("joins the aliases with the absorbed name; the kept one's fields win, missing ones come over", () => {
    expect(mergeMemory(keep, absorbed)).toEqual({
      aliases: ["PAG*PADARIA", "PADARIA SJ", "Padaria Sao Joao"],
      document: "12345678000190",
      defaultCategoryId: "padaria",
      defaultDescription: "Pão",
      documentDropped: null,
    });
  });

  it("a different document on the absorbed one is dropped, and says so", () => {
    expect(mergeMemory({ ...keep, document: "11144477735" }, absorbed)).toMatchObject({
      document: "11144477735",
      documentDropped: "12345678000190",
    });
    expect(
      mergeMemory({ ...keep, document: "12345678000190" }, absorbed).documentDropped,
    ).toBeNull();
  });

  it("past 10 aliases the oldest go, and the absorbed name always stays", () => {
    const many = Array.from({ length: 10 }, (_, i) => `APELIDO ${i}`);
    const merged = mergeMemory({ ...keep, aliases: many }, { ...absorbed, aliases: ["NOVO"] });
    expect(merged.aliases).toHaveLength(10);
    expect(merged.aliases.slice(-2)).toEqual(["NOVO", "Padaria Sao Joao"]);
    expect(merged.aliases).not.toContain("APELIDO 0");
  });

  it("an absorbed name equal to the kept name isn't an alias", () => {
    expect(
      mergeMemory(keep, { ...absorbed, name: "PADARIA DO BAIRRO", aliases: [] }).aliases,
    ).toEqual(["PAG*PADARIA"]);
  });
});
