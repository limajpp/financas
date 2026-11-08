import { describe, expect, it } from "vitest";

import { formatBRL } from "@/domain/money";

import { describeItem } from "./describe-item";
import type { ListItemView } from "./types";

const base: ListItemView = {
  id: "1",
  type: "EXPENSE",
  amountCents: 10_000,
  date: "2026-11-07",
  createdAt: "2026-11-07T15:00:00.000Z",
  method: "PIX",
  description: null,
  invoiceDueDate: null,
  invoiceOverridden: false,
  installmentGroupId: null,
  installmentNumber: null,
  installmentTotal: null,
  installmentGroupCents: null,
  recurringRuleId: null,
  recurringRule: null,
  account: { id: "a", name: "Banco Azul" },
  toAccount: null,
  card: null,
  category: null,
  counterparty: null,
};

describe("describeItem", () => {
  it("CA3: an installment shows the card and 3/10", () => {
    expect(
      describeItem({
        ...base,
        method: "CREDIT",
        account: null,
        card: { id: "c", name: "Cartão Roxo" },
        installmentGroupId: "g",
        installmentNumber: 3,
        installmentTotal: 10,
        counterparty: { id: "p", name: "Loja de Móveis" },
      }),
    ).toEqual({
      title: "Loja de Móveis",
      line: "Cartão Roxo · 3/10",
      amount: `−${formatBRL(10_000)}`,
    });
  });

  it("expense, income, transfer, invoice payment and subscription", () => {
    expect(describeItem({ ...base, description: "Pão" })).toMatchObject({
      title: "Pão",
      line: "Banco Azul · Pix",
      amount: `−${formatBRL(10_000)}`,
    });
    expect(describeItem({ ...base, type: "INCOME", method: "TED" }).amount).toBe(
      `+${formatBRL(10_000)}`,
    );
    expect(
      describeItem({ ...base, type: "TRANSFER", toAccount: { id: "v", name: "Banco Verde" } }),
    ).toMatchObject({
      title: "Transferência",
      line: "Banco Azul → Banco Verde",
      amount: formatBRL(10_000),
    });
    expect(
      describeItem({ ...base, type: "CARD_PAYMENT", card: { id: "c", name: "Cartão Roxo" } }),
    ).toMatchObject({ title: "Pagamento de fatura", line: "Pagamento · Cartão Roxo" });
    expect(describeItem({ ...base, recurringRuleId: "r" }).line).toBe(
      "Banco Azul · Pix · Assinatura",
    );
  });
});
