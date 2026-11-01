import { describe, expect, it } from "vitest";

import { DOCUMENT_ERROR_MESSAGES, formatDocument, parseDocument } from "./document";

describe("parseDocument", () => {
  it("accepts a CPF with or without punctuation", () => {
    expect(parseDocument("529.982.247-25")).toEqual({ ok: true, document: "52998224725" });
    expect(parseDocument("52998224725")).toEqual({ ok: true, document: "52998224725" });
    expect(parseDocument(" 529 982 247 25 ")).toEqual({ ok: true, document: "52998224725" });
  });

  it("accepts a numeric CNPJ", () => {
    expect(parseDocument("11.222.333/0001-81")).toEqual({ ok: true, document: "11222333000181" });
    expect(parseDocument("12345678000195")).toEqual({ ok: true, document: "12345678000195" });
  });

  it("accepts an alphanumeric CNPJ, in any case", () => {
    expect(parseDocument("12.ABC.345/01DE-35")).toEqual({ ok: true, document: "12ABC34501DE35" });
    expect(parseDocument("12.abc.345/01de-35")).toEqual({ ok: true, document: "12ABC34501DE35" });
  });

  it("refuses wrong check digits, each with its message", () => {
    expect(parseDocument("529.982.247-24")).toEqual({ ok: false, error: "INVALID_CPF" });
    expect(parseDocument("11.222.333/0001-80")).toEqual({ ok: false, error: "INVALID_CNPJ" });
    expect(parseDocument("12.ABC.345/01DE-36")).toEqual({ ok: false, error: "INVALID_CNPJ" });
  });

  it("refuses repeated sequences", () => {
    expect(parseDocument("111.111.111-11")).toEqual({ ok: false, error: "INVALID_CPF" });
    expect(parseDocument("00.000.000/0000-00")).toEqual({ ok: false, error: "INVALID_CNPJ" });
  });

  it("refuses a wrong length, letters in a CPF or in a CNPJ's check digits, and other symbols", () => {
    for (const text of ["", "1234", "529.982.247-2", "123456789012", "1234567800019512"]) {
      expect(parseDocument(text)).toEqual({ ok: false, error: "INVALID_LENGTH" });
    }
    expect(parseDocument("5299822472A")).toEqual({ ok: false, error: "INVALID_CPF" });
    expect(parseDocument("12ABC34501DEAB")).toEqual({ ok: false, error: "INVALID_CNPJ" });
    expect(parseDocument("529*982*247*25")).toEqual({ ok: false, error: "INVALID_LENGTH" });
  });

  it("has a clear message for each error", () => {
    expect(DOCUMENT_ERROR_MESSAGES).toEqual({
      INVALID_CPF: "CPF inválido. Confira os números.",
      INVALID_CNPJ: "CNPJ inválido. Confira os caracteres.",
      INVALID_LENGTH: "Informe um CPF (11 dígitos) ou um CNPJ (14 caracteres).",
    });
  });
});

describe("formatDocument", () => {
  it("formats CPF and CNPJ for display", () => {
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatDocument("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
  });

  it("leaves anything else as is", () => {
    expect(formatDocument("123")).toBe("123");
  });
});
