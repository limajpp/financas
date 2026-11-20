import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { spendingByCategory } from "@/domain/totals";
import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { createAccount } from "@/server/accounts";
import { createCard, setCardArchived } from "@/server/cards";
import { cardsOverview } from "@/server/invoices";
import {
  createOngoingInstallments,
  createSubscriptionRule,
  finishOnboarding,
  needsOnboarding,
  setOpeningBalance,
} from "@/server/onboarding";
import { generateRecurring } from "@/server/recurring";
import { ensurePersonalSpace } from "@/server/spaces";
import { listTransactions } from "@/server/transaction-list";
import { accountBalances, cardInvoices, deleteTransaction } from "@/server/transactions";
import { resetDatabase } from "@/test/db";

beforeEach(resetDatabase);
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

let minute = 0;
function on(day = "2026-11-15") {
  vi.useFakeTimers({ toFake: ["Date"] });
  minute += 1;
  vi.setSystemTime(new Date(`${day}T15:${String(minute % 60).padStart(2, "0")}:00Z`));
}

/** "Banco Azul" and "Cartão Roxo" (closes on the 3rd, due on the 10th), on 15/11/2026. */
async function setup(email = "ana@example.com", day = "2026-11-15") {
  on(day);
  const user = await db.user.create({ data: { name: "Ana Teste", email } });
  const space = await ensurePersonalSpace(user.id);
  const account = await createAccount(
    space.id,
    accountSchema.parse({
      name: "Banco Azul",
      color: "blue",
      initialBalance: "1.000,00",
      initialBalanceDate: day,
    }),
  );
  if (!account.ok) throw new Error(account.error);
  const card = await createCard(
    space.id,
    cardSchema.parse({
      name: "Cartão Roxo",
      accountId: account.account.id,
      closingDay: 3,
      dueDay: 10,
    }),
  );
  if (!card.ok) throw new Error(card.error);
  const category = (name: string) =>
    db.category.findFirstOrThrow({ where: { spaceId: space.id, name } });
  return {
    userId: user.id,
    spaceId: space.id,
    accountId: account.account.id,
    cardId: card.card.id,
    eletronicos: await category("Eletrônicos"),
    salario: await category("Salário"),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const OPEN = "2026-12-10";

const ongoing = (
  s: Setup,
  input: Partial<Parameters<typeof createOngoingInstallments>[3]> = {},
  clientId = randomUUID(),
) =>
  createOngoingInstallments(s.spaceId, s.userId, clientId, {
    cardId: s.cardId,
    counterparty: "Loja Grande",
    categoryId: s.eletronicos.id,
    current: 3,
    total: 10,
    amountCents: 15_000,
    ...input,
  });

const invoice = async (s: Setup, dueDate: string) =>
  (await cardInvoices(s.spaceId, s.cardId))!.invoices.find((i) => i.dueDate === dueDate);

describe("parcelamentos em andamento", () => {
  it("CA1: 3 de 10 de R$ 150 cria 8 parcelas, 3 a 10, uma por fatura a partir da aberta", async () => {
    const s = await setup();
    const result = await ongoing(s);
    expect(result).toEqual({ ok: true, created: true, deductedCents: 0 });

    const rows = await db.transaction.findMany({
      where: { spaceId: s.spaceId, installmentGroupId: { not: null } },
      orderBy: { installmentNumber: "asc" },
    });
    expect(rows.map((r) => r.installmentNumber)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows.every((r) => r.installmentTotal === 10 && r.amountCents === 15_000)).toBe(true);
    expect(new Set(rows.map((r) => r.installmentGroupId)).size).toBe(1);
    expect(rows.map((r) => r.invoiceDueDate!.toISOString().slice(0, 10))).toEqual([
      "2026-12-10",
      "2027-01-10",
      "2027-02-10",
      "2027-03-10",
      "2027-04-10",
      "2027-05-10",
      "2027-06-10",
      "2027-07-10",
    ]);
    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      "2026-11-15",
      "2026-12-15",
      "2027-01-15",
      "2027-02-15",
      "2027-03-15",
      "2027-04-15",
      "2027-05-15",
      "2027-06-15",
    ]);
    expect(rows.every((r) => r.categoryId === s.eletronicos.id && r.counterpartyId)).toBe(true);
    // It counts as spending, like any installment.
    expect(spendingByCategory(rows)).toEqual(new Map([[s.eletronicos.id, 120_000]]));
    // The invoices: 150 on each, from the open one on.
    expect((await invoice(s, OPEN))?.totalCents).toBe(15_000);
    expect((await invoice(s, "2027-07-10"))?.status).toBe("future");
  });

  it("CA4: repetir o mesmo clientId não duplica nem desconta duas vezes", async () => {
    const s = await setup();
    await setOpeningBalance(s.spaceId, s.userId, s.cardId, OPEN, 100_000);
    const clientId = randomUUID();
    const [a, b] = await Promise.all([ongoing(s, {}, clientId), ongoing(s, {}, clientId)]);
    expect([a, b].filter((r) => r.ok && r.created)).toHaveLength(1);
    expect(await ongoing(s, {}, clientId)).toEqual({ ok: true, created: false, deductedCents: 0 });
    expect(await db.transaction.count({ where: { installmentGroupId: { not: null } } })).toBe(8);
    expect((await invoice(s, OPEN))?.totalCents).toBe(100_000);
  });

  it("CA4: recusa 1 de 1, a última parcela, valor zero, e cartão ou categoria de fora", async () => {
    const s = await setup();
    const other = await setup("bia@example.com");
    expect(await ongoing(s, { current: 1, total: 1 })).toEqual({
      ok: false,
      error: "INVALID_INSTALLMENTS",
    });
    expect(await ongoing(s, { current: 10, total: 10 })).toEqual({
      ok: false,
      error: "LAST_INSTALLMENT",
    });
    expect(await ongoing(s, { amountCents: 0 })).toEqual({ ok: false, error: "INVALID_AMOUNT" });
    expect(await ongoing(s, { cardId: other.cardId })).toEqual({
      ok: false,
      error: "CARD_NOT_FOUND",
    });
    expect(await ongoing(s, { categoryId: other.eletronicos.id })).toEqual({
      ok: false,
      error: "CATEGORY_NOT_FOUND",
    });
    expect(await ongoing(s, { categoryId: s.salario.id })).toEqual({
      ok: false,
      error: "CATEGORY_TYPE_MISMATCH",
    });
    await setCardArchived(s.spaceId, s.cardId, true);
    expect(await ongoing(s)).toEqual({ ok: false, error: "CARD_ARCHIVED" });
    expect(await db.transaction.count()).toBe(0);
  });

  it("sem estabelecimento e sem categoria também vale", async () => {
    const s = await setup();
    expect(await ongoing(s, { counterparty: null, categoryId: null })).toMatchObject({ ok: true });
  });
});

describe("saldo anterior da fatura", () => {
  it("CA2: entra no total da fatura e no Pagar fatura, fora dos gastos, e gravar de novo substitui", async () => {
    const s = await setup();
    expect(await setOpeningBalance(s.spaceId, s.userId, s.cardId, OPEN, 80_000)).toEqual({
      ok: true,
      openingCents: 80_000,
    });
    expect((await invoice(s, OPEN))?.totalCents).toBe(80_000);
    expect(await setOpeningBalance(s.spaceId, s.userId, s.cardId, OPEN, 95_000)).toMatchObject({
      ok: true,
    });
    const payment = (await cardInvoices(s.spaceId, s.cardId))!;
    expect(payment.invoices.find((i) => i.dueDate === OPEN)?.remainingCents).toBe(95_000);

    const rows = await db.transaction.findMany({ where: { spaceId: s.spaceId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "EXPENSE",
      method: "CREDIT",
      adjustment: true,
      accountId: null,
      categoryId: null,
      counterpartyId: null,
      invoiceOverridden: true,
      description: "Saldo anterior da fatura",
    });
    expect(spendingByCategory(rows)).toEqual(new Map());
    // It isn't the account's money: the balance stays.
    expect((await accountBalances(s.spaceId)).get(s.accountId)).toBe(100_000);
    // Nor a day's spending on the list.
    const page = await listTransactions(s.spaceId, { from: "2026-11-01", to: "2026-11-30" });
    expect(page.items).toHaveLength(1);
    expect(page.dayTotals["2026-11-15"]).toBe(0);

    // Zero deletes it.
    await setOpeningBalance(s.spaceId, s.userId, s.cardId, OPEN, 0);
    expect(await db.transaction.count()).toBe(0);
  });

  it("CA2: com um parcelamento, a parcela atual sai do saldo anterior e o total continua o informado", async () => {
    const s = await setup();
    await setOpeningBalance(s.spaceId, s.userId, s.cardId, OPEN, 100_000);
    expect(await ongoing(s)).toEqual({ ok: true, created: true, deductedCents: 15_000 });
    expect((await invoice(s, OPEN))?.totalCents).toBe(100_000);
    const opening = await db.transaction.findFirstOrThrow({ where: { adjustment: true } });
    expect(opening.amountCents).toBe(85_000);

    // Informing the bank's amount again keeps the installment out of it.
    await setOpeningBalance(s.spaceId, s.userId, s.cardId, OPEN, 110_000);
    expect((await invoice(s, OPEN))?.totalCents).toBe(110_000);
    expect(
      (await db.transaction.findFirstOrThrow({ where: { adjustment: true } })).amountCents,
    ).toBe(95_000);
  });

  it("o parcelamento antes do saldo anterior dá o mesmo resultado", async () => {
    const s = await setup();
    await ongoing(s);
    expect(await setOpeningBalance(s.spaceId, s.userId, s.cardId, OPEN, 100_000)).toEqual({
      ok: true,
      openingCents: 85_000,
    });
    expect((await invoice(s, OPEN))?.totalCents).toBe(100_000);
  });

  it("uma parcela maior que o saldo anterior o zera e apaga", async () => {
    const s = await setup();
    await setOpeningBalance(s.spaceId, s.userId, s.cardId, OPEN, 10_000);
    expect(await ongoing(s)).toEqual({ ok: true, created: true, deductedCents: 10_000 });
    expect(await db.transaction.count({ where: { adjustment: true } })).toBe(0);
    expect((await invoice(s, OPEN))?.totalCents).toBe(15_000);
  });

  it("a fatura fechada que ainda não venceu também aceita, e entra no Pagar fatura", async () => {
    const s = await setup("ana@example.com", "2026-11-05");
    // On 05/11 the invoice that closed on 03/11 is due on 10/11.
    expect(
      await setOpeningBalance(s.spaceId, s.userId, s.cardId, "2026-11-10", 50_000),
    ).toMatchObject({ ok: true });
    const payment = (await cardInvoices(s.spaceId, s.cardId))!;
    expect(payment.defaultDueDate).toBe("2026-11-10");
    expect(payment.invoices.find((i) => i.dueDate === "2026-11-10")).toMatchObject({
      status: "closed",
      remainingCents: 50_000,
    });
    const overview = await cardsOverview(s.spaceId);
    expect(overview[0]!.payment.invoices.map((i) => i.dueDate)).toEqual([
      "2026-11-10",
      "2026-12-10",
    ]);
  });

  it("CA4: fatura fora das permitidas e cartão de outro espaço são recusados", async () => {
    const s = await setup();
    const other = await setup("bia@example.com");
    // On 15/11 the invoice due on 10/11 is past due; 10/01 isn't open yet.
    for (const due of ["2026-11-10", "2027-01-10", "2026-12-11"]) {
      expect(await setOpeningBalance(s.spaceId, s.userId, s.cardId, due, 1_000)).toEqual({
        ok: false,
        error: "INVALID_INVOICE",
      });
    }
    expect(await setOpeningBalance(s.spaceId, s.userId, other.cardId, OPEN, 1_000)).toEqual({
      ok: false,
      error: "CARD_NOT_FOUND",
    });
    expect(await db.transaction.count()).toBe(0);
  });

  it("um ajuste no crédito não pode ter categoria (CHECK)", async () => {
    const s = await setup();
    await setOpeningBalance(s.spaceId, s.userId, s.cardId, OPEN, 1_000);
    await expect(
      db.transaction.updateMany({
        where: { adjustment: true },
        data: { categoryId: s.eletronicos.id },
      }),
    ).rejects.toThrow(/Transaction_adjustment_check/);
    await expect(
      db.transaction.updateMany({ where: { adjustment: true }, data: { type: "INCOME" } }),
    ).rejects.toThrow(/Transaction_adjustment_check/);
  });

  it("excluir funciona como nos outros ajustes", async () => {
    const s = await setup();
    await setOpeningBalance(s.spaceId, s.userId, s.cardId, OPEN, 1_000);
    const row = await db.transaction.findFirstOrThrow({ where: { adjustment: true } });
    expect(await deleteTransaction(s.spaceId, row.id)).toMatchObject({ ok: true });
    expect(await db.transaction.count()).toBe(0);
  });
});

describe("assinaturas ativas", () => {
  const rule = (s: Setup, input: Partial<Parameters<typeof createSubscriptionRule>[2]> = {}) =>
    createSubscriptionRule(s.spaceId, s.userId, {
      counterparty: "Streaming Azul",
      amountCents: 3_990,
      dayOfMonth: 8,
      method: "CREDIT",
      accountId: null,
      cardId: s.cardId,
      categoryId: null,
      description: null,
      ...input,
    });

  it("CA3: não cobra hoje; a primeira cobrança é a primeira data depois de hoje", async () => {
    const s = await setup();
    const day8 = await rule(s);
    const day20 = await rule(s, {
      counterparty: "Academia",
      dayOfMonth: 20,
      method: "PIX",
      accountId: s.accountId,
      cardId: null,
    });
    expect(day8.ok && day20.ok).toBe(true);
    await generateRecurring(s.spaceId);
    expect(await db.transaction.count()).toBe(0);
    const rules = await db.recurringRule.findMany({ orderBy: { dayOfMonth: "asc" } });
    expect(rules.map((r) => [r.firstMonth, r.nextMonth])).toEqual([
      ["2026-12", "2026-12"],
      ["2026-11", "2026-11"],
    ]);

    on("2026-11-20");
    await generateRecurring(s.spaceId);
    const charges = await db.transaction.findMany({ select: { amountCents: true, date: true } });
    expect(charges.map((c) => c.date.toISOString().slice(0, 10))).toEqual(["2026-11-20"]);

    on("2026-12-08");
    await generateRecurring(s.spaceId);
    expect(await db.transaction.count()).toBe(2);
  });

  it("CA4: recusa conta, cartão ou categoria de outro espaço, e a mesma assinatura duas vezes", async () => {
    const s = await setup();
    const other = await setup("bia@example.com");
    expect(await rule(s, { cardId: other.cardId })).toEqual({
      ok: false,
      error: "CARD_NOT_FOUND",
    });
    expect(await rule(s, { method: "PIX", cardId: null, accountId: other.accountId })).toEqual({
      ok: false,
      error: "ACCOUNT_NOT_FOUND",
    });
    expect(await rule(s, { categoryId: other.eletronicos.id })).toEqual({
      ok: false,
      error: "CATEGORY_NOT_FOUND",
    });
    const [a, b] = await Promise.all([rule(s), rule(s)]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, error: "DUPLICATE_SUBSCRIPTION" });
    expect(await db.recurringRule.count({ where: { spaceId: s.spaceId } })).toBe(1);
  });
});

describe("concluir", () => {
  it("um espaço novo ainda tem o onboarding; concluir o tira", async () => {
    const s = await setup();
    expect(await needsOnboarding(s.spaceId)).toBe(true);
    await finishOnboarding(s.spaceId);
    expect(await needsOnboarding(s.spaceId)).toBe(false);
    const { onboardedAt } = await db.space.findUniqueOrThrow({ where: { id: s.spaceId } });
    await finishOnboarding(s.spaceId);
    expect((await db.space.findUniqueOrThrow({ where: { id: s.spaceId } })).onboardedAt).toEqual(
      onboardedAt,
    );
  });
});
