import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  filtersToParams,
  monthRange,
  parseFilters,
} from "./transaction-filters";

const today = "2026-11-08";
const id = "0190a1b2-0000-7000-8000-000000000001";

describe("parseFilters", () => {
  it("defaults to the current month", () => {
    expect(parseFilters({}, today)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });

  it("reads every filter from the URL", () => {
    expect(
      parseFilters(
        {
          de: "2026-10-01",
          ate: "2026-10-15",
          conta: id,
          cartao: id,
          forma: "PIX",
          categoria: "none",
          estabelecimento: id,
          tipo: "EXPENSE",
          q: "  padaria ",
        },
        today,
      ),
    ).toEqual({
      from: "2026-10-01",
      to: "2026-10-15",
      accountId: id,
      cardId: id,
      method: "PIX",
      categoryId: "none",
      counterpartyId: id,
      type: "EXPENSE",
      q: "padaria",
    });
  });

  it("drops invalid values instead of failing", () => {
    expect(
      parseFilters(
        { de: "2026-02-30", conta: "azul", forma: "CHEQUE", tipo: "X", q: "   " },
        today,
      ),
    ).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });

  it("only a start date: that month; swapped dates are put in order; repeated params take the first", () => {
    expect(parseFilters({ de: "2026-02-10" }, today)).toEqual({
      from: "2026-02-10",
      to: "2026-02-28",
    });
    expect(parseFilters({ de: "2026-10-20", ate: "2026-10-01" }, today)).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-20",
    });
    expect(parseFilters({ forma: ["PIX", "TED"] }, today)).toMatchObject({ method: "PIX" });
  });
});

describe("filtersToParams / activeFilterCount / monthRange", () => {
  it("round-trips through the URL", () => {
    const filters = parseFilters(
      { de: "2026-10-01", ate: "2026-10-31", conta: id, q: "pão" },
      today,
    );
    expect(parseFilters(Object.fromEntries(filtersToParams(filters)), today)).toEqual(filters);
    expect(filtersToParams(filters).toString()).toBe(
      `de=2026-10-01&ate=2026-10-31&conta=${id}&q=p%C3%A3o`,
    );
  });

  it("counts the filters besides the period and the search", () => {
    expect(activeFilterCount(parseFilters({ conta: id, tipo: "INCOME", q: "x" }, today))).toBe(2);
  });

  it("knows the month's last day", () => {
    expect(monthRange("2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
});
