import { describe, expect, it } from "vitest";

import { cardSchema } from "./cards";

const valid = {
  name: " Cartão Roxo ",
  accountId: "0190f0e2-0000-7000-8000-000000000001",
  closingDay: "3",
  dueDay: "10",
  limit: "",
};

const issues = (input: object) =>
  cardSchema.safeParse({ ...valid, ...input }).error?.issues.map((i) => i.message);

describe("cardSchema", () => {
  it("parses the days and the optional limit", () => {
    expect(cardSchema.parse(valid)).toEqual({
      name: "Cartão Roxo",
      accountId: valid.accountId,
      closingDay: 3,
      dueDay: 10,
      limit: null,
    });
    expect(cardSchema.parse({ ...valid, limit: "5.000" }).limit).toBe(500000);
  });

  it("explains what's wrong in pt-BR", () => {
    expect(issues({ closingDay: "0" })).toEqual(["Escolha o dia do fechamento."]);
    expect(issues({ dueDay: "32" })).toEqual(["Escolha o dia do vencimento."]);
    expect(issues({ dueDay: "2.5" })).toEqual(["Escolha o dia do vencimento."]);
    expect(issues({ closingDay: "" })).toEqual(["Escolha o dia do fechamento."]);
    expect(issues({ accountId: "" })).toEqual(["Escolha a conta que paga a fatura."]);
    expect(issues({ limit: "0" })).toEqual(["Limite inválido. Use um valor maior que zero."]);
    expect(issues({ limit: "-10" })).toEqual(["Limite inválido. Use um valor maior que zero."]);
    expect(issues({ limit: "12.5" })).toEqual([
      "Limite inválido. Use o formato 1.234,56, até R$ 20.000.000,00.",
    ]);
    expect(issues({ limit: "30.000.000" })).toEqual([
      "Limite inválido. Use o formato 1.234,56, até R$ 20.000.000,00.",
    ]);
    expect(issues({ closingDay: true })).toEqual(["Escolha o dia do fechamento."]);
    expect(issues({ closingDay: [5] })).toEqual(["Escolha o dia do fechamento."]);
  });
});
