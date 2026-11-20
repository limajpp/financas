import { describe, expect, it } from "vitest";

import { formatBRL, formatBRLInput, parseBRL } from "./money";

// Intl separates "R$" from the amount with a non-breaking space (U+00A0).
const nbsp = " ";

describe("formatBRL", () => {
  it("formats cents as Brazilian reais", () => {
    expect(formatBRL(4790)).toBe(`R$${nbsp}47,90`);
  });

  it("formats zero", () => {
    expect(formatBRL(0)).toBe(`R$${nbsp}0,00`);
  });

  it("uses a dot as the thousands separator", () => {
    expect(formatBRL(123456)).toBe(`R$${nbsp}1.234,56`);
  });

  it("puts the minus sign before the currency symbol", () => {
    expect(formatBRL(-500)).toBe(`-R$${nbsp}5,00`);
  });

  it("never shows a sign for negative zero", () => {
    expect(formatBRL(-0)).toBe(`R$${nbsp}0,00`);
  });

  it("rejects fractional cents", () => {
    expect(() => formatBRL(10.5)).toThrow(RangeError);
  });
});

describe("parseBRL", () => {
  it.each([
    ["1.234,56", 123456],
    ["1234,56", 123456],
    ["1234", 123400],
    ["0,5", 50],
    ["0,05", 5],
    ["0", 0],
    ["R$ 1.234,56", 123456],
    ["R$1.234,56", 123456],
    ["  47,90  ", 4790],
    ["1.234", 123400],
    ["1.234.567,89", 123456789],
    ["-350", -35000],
    ["−350,00", -35000],
    ["- 350,00", -35000],
    ["-R$ 350,00", -35000],
    ["R$ -350,00", -35000],
    ["-0", 0],
    ["20.000.000,00", 2_000_000_000],
    ["-20.000.000,00", -2_000_000_000],
  ])("%s → %d cents", (input, cents) => {
    expect(parseBRL(input)).toBe(cents);
  });

  it.each([
    "",
    "   ",
    "abc",
    "12.5",
    "1.23,45",
    "1.2345",
    "1,234",
    "1,",
    ",5",
    "1.234.56",
    "1 234",
    "--5",
    "5-",
    "R$",
    "20.000.000,01",
    "-20.000.000,01",
    "99999999999999999999",
  ])("%j is not an amount", (input) => {
    expect(parseBRL(input)).toBeNull();
  });

  it("rejects long input quickly (no catastrophic backtracking)", () => {
    const started = performance.now();
    expect(parseBRL("-" + " ".repeat(100_000) + "x")).toBeNull();
    expect(parseBRL("R$" + " ".repeat(20) + "x")).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("never returns negative zero", () => {
    expect(Object.is(parseBRL("-0,00"), 0)).toBe(true);
  });
});

describe("formatBRLInput", () => {
  it("formats cents for an input field, without the currency symbol", () => {
    expect(formatBRLInput(123456)).toBe("1.234,56");
    expect(formatBRLInput(50)).toBe("0,50");
    expect(formatBRLInput(0)).toBe("0,00");
    expect(formatBRLInput(-35000)).toBe("-350,00");
  });

  it("round-trips with parseBRL", () => {
    for (const cents of [0, 1, 99, 100, 123456, -35000, 2_000_000_000]) {
      expect(parseBRL(formatBRLInput(cents))).toBe(cents);
    }
  });
});
