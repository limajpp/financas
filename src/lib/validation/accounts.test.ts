import { describe, expect, it } from "vitest";

import { accountSchema } from "./accounts";

const valid = {
  name: " Banco Azul ",
  color: "blue",
  initialBalance: "1.234,56",
  negative: false,
  initialBalanceDate: "2026-10-31",
};

const issues = (input: object) =>
  accountSchema.safeParse({ ...valid, ...input }).error?.issues.map((i) => i.message);

describe("accountSchema", () => {
  it("parses the typed amount into cents and trims the name", () => {
    expect(accountSchema.parse(valid)).toEqual({
      name: "Banco Azul",
      color: "blue",
      initialBalanceCents: 123456,
      initialBalanceDate: "2026-10-31",
    });
  });

  it("the negative option flips the sign; a typed minus also works; zero stays zero", () => {
    expect(accountSchema.parse({ ...valid, initialBalance: "350", negative: true })).toMatchObject({
      initialBalanceCents: -35000,
    });
    expect(accountSchema.parse({ ...valid, initialBalance: "-350" })).toMatchObject({
      initialBalanceCents: -35000,
    });
    expect(accountSchema.parse({ ...valid, initialBalance: "-350", negative: true })).toMatchObject(
      { initialBalanceCents: -35000 },
    );
    const zero = accountSchema.parse({ ...valid, initialBalance: "0", negative: true });
    expect(Object.is(zero.initialBalanceCents, 0)).toBe(true);
  });

  it("explains what's wrong in pt-BR", () => {
    expect(issues({ initialBalance: "  " })).toEqual(["Informe o saldo inicial."]);
    expect(issues({ initialBalance: "12.5" })).toEqual(["Valor inválido. Use o formato 1.234,56."]);
    expect(issues({ initialBalanceDate: "2026-02-30" })).toEqual(["Data inválida."]);
    expect(issues({ name: "" })).toEqual(["Informe o nome."]);
    expect(issues({ color: "black" })).toEqual(["Cor inválida."]);
  });
});
