import { describe, expect, it } from "vitest";

import { cardPaymentSchema, clientIdSchema, entrySchema, transferSchema } from "./transactions";

const accountId = "0190a1b2-0000-7000-8000-000000000001";
const cardId = "0190a1b2-0000-7000-8000-000000000002";
const categoryId = "0190a1b2-0000-7000-8000-000000000003";

const base = {
  type: "EXPENSE",
  amountCents: 1234,
  date: "2026-10-20",
  method: "PIX",
  accountId,
};

function issues(input: unknown) {
  const result = entrySchema.safeParse(input);
  if (result.success) throw new Error("expected a failure");
  return Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));
}

describe("entrySchema", () => {
  it("parses a minimal Pix expense, with optional fields as null", () => {
    expect(entrySchema.parse(base)).toEqual({
      ...base,
      cardId: null,
      invoiceDueDate: null,
      categoryId: null,
      counterparty: null,
      counterpartyAlias: null,
      counterpartyDocument: null,
      description: null,
      installments: null,
      subscription: false,
    });
  });

  it("trims texts; empty or blank texts and empty ids become null", () => {
    expect(
      entrySchema.parse({
        ...base,
        counterparty: "  Padaria do Bairro ",
        description: "   ",
        categoryId: "",
        invoiceDueDate: "  ",
      }),
    ).toMatchObject({
      counterparty: "Padaria do Bairro",
      description: null,
      categoryId: null,
      invoiceDueDate: null,
    });
  });

  it("on credit, keeps the card and invoice and drops the account", () => {
    expect(
      entrySchema.parse({ ...base, method: "CREDIT", cardId, invoiceDueDate: "2026-11-12" }),
    ).toMatchObject({ accountId: null, cardId, invoiceDueDate: "2026-11-12" });
  });

  it("off credit, drops the card and invoice", () => {
    expect(
      entrySchema.parse({ ...base, cardId, invoiceDueDate: "2026-11-12", categoryId }),
    ).toMatchObject({ accountId, cardId: null, invoiceDueDate: null, categoryId });
  });

  it("asks for the account or the card that the method needs", () => {
    expect(issues({ ...base, accountId: undefined })).toEqual({ accountId: "Escolha a conta." });
    expect(issues({ ...base, method: "CREDIT" })).toEqual({ cardId: "Escolha o cartão." });
  });

  it("refuses a missing, zero, fractional or too large amount", () => {
    expect(issues({ ...base, amountCents: undefined })).toEqual({
      amountCents: "Informe o valor.",
    });
    expect(issues({ ...base, amountCents: 0 })).toEqual({
      amountCents: "O valor precisa ser maior que zero.",
    });
    expect(issues({ ...base, amountCents: 12.5 })).toEqual({ amountCents: "Valor inválido." });
    expect(issues({ ...base, amountCents: 2_000_000_001 })).toEqual({
      amountCents: "O valor pode ser no máximo R$ 20.000.000,00.",
    });
    expect(issues({ ...base, amountCents: "1234" })).toEqual({ amountCents: "Informe o valor." });
  });

  it("refuses an invalid date, type or method", () => {
    expect(issues({ ...base, date: "" })).toEqual({ date: "Informe a data." });
    expect(issues({ ...base, date: "2026-02-30" })).toEqual({ date: "Data inválida." });
    expect(issues({ ...base, type: "TRANSFER" })).toEqual({ type: "Tipo inválido." });
    expect(issues({ ...base, method: "CHEQUE" })).toEqual({
      method: "Escolha a forma de pagamento.",
    });
  });

  it("refuses texts over the limit and ids that aren't UUIDs", () => {
    expect(issues({ ...base, counterparty: "x".repeat(61) })).toEqual({
      counterparty: "O estabelecimento pode ter no máximo 60 caracteres.",
    });
    expect(issues({ ...base, description: "x".repeat(121) })).toEqual({
      description: "A descrição pode ter no máximo 120 caracteres.",
    });
    expect(issues({ ...base, accountId: "azul" })).toEqual({ accountId: "Conta não encontrada." });
    expect(issues({ ...base, categoryId: "mercado" })).toEqual({
      categoryId: "Categoria não encontrada.",
    });
    expect(issues({ ...base, method: "CREDIT", cardId, invoiceDueDate: "12/11" })).toEqual({
      invoiceDueDate: "Fatura inválida.",
    });
  });
});

describe("entrySchema: counterparty alias and CPF/CNPJ", () => {
  it("normalizes a valid CPF/CNPJ and trims the alias", () => {
    expect(
      entrySchema.parse({
        ...base,
        counterparty: "Padaria",
        counterpartyAlias: "  PAG*JOSE SILVA ",
        counterpartyDocument: "12.abc.345/01de-35",
      }),
    ).toMatchObject({
      counterpartyAlias: "PAG*JOSE SILVA",
      counterpartyDocument: "12ABC34501DE35",
    });
  });

  it("CA4: refuses an invalid CPF/CNPJ with a clear message", () => {
    expect(
      issues({ ...base, counterparty: "Padaria", counterpartyDocument: "529.982.247-24" }),
    ).toEqual({
      counterpartyDocument: "CPF inválido. Confira os números.",
    });
    expect(
      issues({ ...base, counterparty: "Padaria", counterpartyDocument: "11.222.333/0001-80" }),
    ).toEqual({
      counterpartyDocument: "CNPJ inválido. Confira os caracteres.",
    });
    expect(issues({ ...base, counterparty: "Padaria", counterpartyDocument: "123" })).toEqual({
      counterpartyDocument: "Informe um CPF (11 dígitos) ou um CNPJ (14 caracteres).",
    });
  });

  it("asks for the counterparty when only the alias or the CPF/CNPJ comes", () => {
    expect(issues({ ...base, counterpartyAlias: "PAG*JOSE" })).toEqual({
      counterparty: "Informe o que foi para guardar o nome no extrato.",
    });
    expect(issues({ ...base, counterpartyDocument: "529.982.247-25" })).toEqual({
      counterparty: "Informe o que foi para guardar o CPF/CNPJ.",
    });
  });

  it("refuses an alias over 60 characters", () => {
    expect(issues({ ...base, counterparty: "X", counterpartyAlias: "x".repeat(61) })).toEqual({
      counterpartyAlias: "O nome no extrato pode ter no máximo 60 caracteres.",
    });
  });
});

describe("entrySchema: installments", () => {
  const credit = { ...base, method: "CREDIT", accountId: undefined, cardId };

  it("takes 2 to 24 installments on a credit purchase and drops a manual invoice", () => {
    expect(
      entrySchema.parse({ ...credit, installments: 3, invoiceDueDate: "2026-11-12" }),
    ).toMatchObject({ installments: 3, invoiceDueDate: null });
    expect(entrySchema.parse({ ...credit, installments: "" })).toMatchObject({
      installments: null,
    });
  });

  it("refuses a count outside 2–24", () => {
    for (const installments of [1, 25, 2.5]) {
      expect(issues({ ...credit, installments })).toEqual({
        installments: "Escolha de 2 a 24 parcelas.",
      });
    }
  });

  it("refuses installments off credit or on an income", () => {
    expect(issues({ ...base, installments: 3 })).toEqual({
      installments: "Só compras no crédito podem ser parceladas.",
    });
    expect(issues({ ...credit, type: "INCOME", installments: 3 })).toEqual({
      installments: "Só compras no crédito podem ser parceladas.",
    });
  });
});

describe("entrySchema: subscription", () => {
  it("defaults to false and takes true on an expense, by any method", () => {
    expect(entrySchema.parse(base)).toMatchObject({ subscription: false });
    expect(entrySchema.parse({ ...base, subscription: true })).toMatchObject({
      subscription: true,
    });
    expect(
      entrySchema.parse({
        ...base,
        method: "CREDIT",
        accountId: undefined,
        cardId,
        subscription: true,
      }),
    ).toMatchObject({ subscription: true, cardId });
  });

  it("refuses it on an income and together with installments", () => {
    expect(issues({ ...base, type: "INCOME", subscription: true })).toEqual({
      subscription: "Só despesas podem ser assinaturas.",
    });
    expect(
      issues({
        ...base,
        method: "CREDIT",
        accountId: undefined,
        cardId,
        installments: 3,
        subscription: true,
      }),
    ).toEqual({ subscription: "Uma compra parcelada não pode ser assinatura." });
  });
});

describe("clientIdSchema", () => {
  it("takes a UUID only", () => {
    expect(clientIdSchema.safeParse(accountId).success).toBe(true);
    expect(clientIdSchema.safeParse("abc").success).toBe(false);
  });
});

describe("transferSchema", () => {
  const transfer = {
    amountCents: 50_000,
    date: "2026-10-20",
    method: "PIX",
    accountId,
    toAccountId: cardId,
  };

  it("parses a transfer; the description is optional", () => {
    expect(transferSchema.parse(transfer)).toEqual({ ...transfer, description: null });
  });

  it("CA3: refuses the same account on both sides", () => {
    const result = transferSchema.safeParse({ ...transfer, toAccountId: accountId });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toMatchObject([
      { path: ["toAccountId"], message: "Escolha contas diferentes." },
    ]);
  });

  it("refuses credit, debit and boleto", () => {
    for (const method of ["CREDIT", "DEBIT", "BOLETO"]) {
      expect(transferSchema.safeParse({ ...transfer, method }).success).toBe(false);
    }
  });
});

describe("cardPaymentSchema", () => {
  const payment = {
    amountCents: 30_000,
    date: "2026-10-25",
    method: "BOLETO",
    accountId,
    cardId,
    invoiceDueDate: "2026-11-12",
  };

  it("parses a payment", () => {
    expect(cardPaymentSchema.parse(payment)).toEqual({ ...payment, description: null });
  });

  it("refuses credit and cash, and a missing invoice", () => {
    expect(cardPaymentSchema.safeParse({ ...payment, method: "CREDIT" }).success).toBe(false);
    expect(cardPaymentSchema.safeParse({ ...payment, method: "CASH" }).success).toBe(false);
    expect(
      cardPaymentSchema.safeParse({ ...payment, invoiceDueDate: "" }).error?.issues,
    ).toMatchObject([{ path: ["invoiceDueDate"], message: "Escolha a fatura." }]);
  });
});
