import { describe, expect, it } from "vitest";

import { formatBRL } from "./money";

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
