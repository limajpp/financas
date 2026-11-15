import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { cardPaymentSchema, entrySchema } from "@/lib/validation/transactions";
import { createAccount } from "@/server/accounts";
import { createCard, updateCard } from "@/server/cards";
import { cardsOverview, invoiceDetail } from "@/server/invoices";
import { ensurePersonalSpace } from "@/server/spaces";
import {
  accountBalances,
  cardInvoices,
  createCardPayment,
  createTransaction,
  updateTransaction,
} from "@/server/transactions";
import { resetDatabase } from "@/test/db";

beforeEach(resetDatabase);
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

let minute = 0;
/** "Now" on `day` in São Paulo; each call moves a minute ahead. */
function at(day = "2026-11-08") {
  vi.useFakeTimers({ toFake: ["Date"] });
  minute += 1;
  vi.setSystemTime(new Date(`${day}T15:${String(minute % 60).padStart(2, "0")}:00Z`));
}

async function setup(email = "ana@example.com") {
  at();
  const user = await db.user.create({ data: { name: "Ana Teste", email } });
  const space = await ensurePersonalSpace(user.id);
  const account = await createAccount(
    space.id,
    accountSchema.parse({
      name: "Banco Azul",
      color: "blue",
      initialBalance: "1.000,00",
      initialBalanceDate: "2026-10-01",
    }),
  );
  if (!account.ok) throw new Error(account.error);
  // Closes on the 3rd, due on the 10th: on 2026-11-08 the open invoice is due 2026-12-10.
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
    card: card.card,
    mercado: await category("Mercado"),
    reembolsos: await category("Reembolsos"),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const entry = (s: Setup, fields: Record<string, unknown> = {}) =>
  entrySchema.parse({
    type: "EXPENSE",
    amountCents: 10_000,
    date: "2026-11-08",
    method: "CREDIT",
    cardId: s.card.id,
    categoryId: s.mercado.id,
    counterparty: "Loja Fictícia",
    ...fields,
  });

async function create(s: Setup, fields: Record<string, unknown> = {}) {
  at();
  const result = await createTransaction(s.spaceId, s.userId, randomUUID(), entry(s, fields));
  if (!result.ok) throw new Error(result.error);
  return result.transaction;
}

const refund = (s: Setup, fields: Record<string, unknown> = {}) =>
  create(s, {
    type: "INCOME",
    amountCents: 2_500,
    categoryId: s.reembolsos.id,
    ...fields,
  });

async function totals(s: Setup) {
  const invoices = (await cardInvoices(s.spaceId, s.card.id))!.invoices;
  return Object.fromEntries(invoices.map((i) => [i.dueDate, i.totalCents]));
}

const groupRows = (groupId: string) =>
  db.transaction.findMany({
    where: { installmentGroupId: groupId },
    orderBy: { installmentNumber: "asc" },
  });

const day = (d: Date | null) => d?.toISOString().slice(0, 10);

describe("estorno no crédito", () => {
  it("CA5: abate a fatura da data e não mexe no saldo de nenhuma conta", async () => {
    const s = await setup();
    await create(s);
    const back = await refund(s);
    expect(back).toMatchObject({
      type: "INCOME",
      method: "CREDIT",
      accountId: null,
      cardId: s.card.id,
      invoiceDueDate: "2026-12-10",
      invoiceOverridden: false,
    });
    expect(await totals(s)).toEqual({ "2026-12-10": 7_500 });
    expect((await accountBalances(s.spaceId)).get(s.accountId)).toBe(100_000);
  });

  it("CA5: o banco recusa uma receita no crédito sem cartão ou sem fatura", async () => {
    const s = await setup();
    const base = {
      spaceId: s.spaceId,
      createdById: s.userId,
      type: "INCOME" as const,
      method: "CREDIT" as const,
      amountCents: 100,
      date: new Date("2026-11-08T00:00:00Z"),
    };
    await expect(
      db.transaction.create({
        data: { ...base, clientId: randomUUID(), invoiceDueDate: new Date("2026-12-10") },
      }),
    ).rejects.toThrow();
    await expect(
      db.transaction.create({ data: { ...base, clientId: randomUUID(), cardId: s.card.id } }),
    ).rejects.toThrow();
    await expect(
      db.transaction.create({
        data: {
          ...base,
          clientId: randomUUID(),
          cardId: s.card.id,
          accountId: s.accountId,
          invoiceDueDate: new Date("2026-12-10"),
        },
      }),
    ).rejects.toThrow();
  });

  it("um estorno maior que as compras deixa a fatura com crédito; pagar ela continua possível", async () => {
    const s = await setup();
    await refund(s, { amountCents: 4_000, date: "2026-11-02" }); // invoice due 2026-11-10
    expect(await totals(s)).toEqual({ "2026-11-10": -4_000, "2026-12-10": 0 });
    at();
    const paid = await createCardPayment(
      s.spaceId,
      s.userId,
      randomUUID(),
      cardPaymentSchema.parse({
        amountCents: 100,
        date: "2026-11-08",
        method: "PIX",
        accountId: s.accountId,
        cardId: s.card.id,
        invoiceDueDate: "2026-11-10",
      }),
    );
    expect(paid.ok).toBe(true);
  });

  it("mudar o ciclo recalcula a fatura do estorno, como a de uma compra", async () => {
    const s = await setup();
    const back = await refund(s, { date: "2026-11-08" });
    at();
    await updateCard(
      s.spaceId,
      s.card.id,
      cardSchema.parse({ name: "Cartão Roxo", accountId: s.accountId, closingDay: 20, dueDay: 27 }),
    );
    // The refund is from today, when the new days start.
    const row = await db.transaction.findUniqueOrThrow({ where: { id: back.id } });
    expect(day(row.invoiceDueDate)).toBe("2026-11-27");
  });
});

describe("detalhe da fatura", () => {
  it("CA2: lista só os lançamentos e pagamentos daquela fatura, e o total é a soma deles", async () => {
    const s = await setup();
    const avulsa = await create(s, { amountCents: 10_000 });
    const parcelada = await create(s, { amountCents: 30_000, installments: 3 });
    const estorno = await refund(s, { amountCents: 2_500 });
    await create(s, { amountCents: 777, date: "2026-11-02" }); // the invoice before
    await create(s, { method: "PIX", cardId: null, accountId: s.accountId, amountCents: 99 });
    at();
    const payment = await createCardPayment(
      s.spaceId,
      s.userId,
      randomUUID(),
      cardPaymentSchema.parse({
        amountCents: 5_000,
        date: "2026-11-08",
        method: "PIX",
        accountId: s.accountId,
        cardId: s.card.id,
        invoiceDueDate: "2026-12-10",
      }),
    );
    if (!payment.ok) throw new Error(payment.error);

    const detail = (await invoiceDetail(s.spaceId, s.card.id, "2026-12-10"))!;
    expect(detail.items.map((i) => i.id).sort()).toEqual(
      [avulsa.id, parcelada.id, estorno.id, payment.transaction.id].sort(),
    );
    const sum = detail.items.reduce(
      (total, i) =>
        total + (i.type === "EXPENSE" ? i.amountCents : i.type === "INCOME" ? -i.amountCents : 0),
      0,
    );
    expect(detail.summary).toMatchObject({
      dueDate: "2026-12-10",
      closingDate: "2026-12-03",
      totalCents: sum,
      paidCents: 5_000,
      remainingCents: sum - 5_000,
      status: "open",
    });
    expect(sum).toBe(10_000 + 10_000 - 2_500);
    expect(detail.items.find((i) => i.id === parcelada.id)).toMatchObject({
      installmentNumber: 1,
      installmentTotal: 3,
      installmentGroupCents: 30_000,
    });
  });

  it("CA2: cartão de outro espaço, data inválida ou fatura que o cartão não tem: null", async () => {
    const s = await setup();
    const bia = await setup("bia@example.com");
    expect(await invoiceDetail(bia.spaceId, s.card.id, "2026-12-10")).toBeNull();
    expect(await invoiceDetail(s.spaceId, s.card.id, "2026-12-11")).toBeNull();
    expect(await invoiceDetail(s.spaceId, s.card.id, "não-é-data")).toBeNull();
    expect(await invoiceDetail(s.spaceId, s.card.id, "2030-01-10")).toBeNull();
    // One of the payable invoices, empty: it exists, with nothing on it.
    expect(await invoiceDetail(s.spaceId, s.card.id, "2026-06-10")).toMatchObject({
      summary: { dueDate: "2026-06-10", totalCents: 0, status: "closed" },
      items: [],
    });
  });

  it("a visão geral traz os ativos em ordem e os arquivados no fim", async () => {
    const s = await setup();
    for (const name of ["Cartão Verde", "Cartão Azul"]) {
      const created = await createCard(
        s.spaceId,
        cardSchema.parse({ name, accountId: s.accountId, closingDay: 3, dueDay: 10 }),
      );
      if (!created.ok) throw new Error(created.error);
    }
    await db.card.update({ where: { id: s.card.id }, data: { archivedAt: new Date() } });
    expect((await cardsOverview(s.spaceId)).map((c) => c.name)).toEqual([
      "Cartão Azul",
      "Cartão Verde",
      "Cartão Roxo",
    ]);
  });
});

describe("trocar a fatura", () => {
  it("CA4: mover uma compra avulsa atualiza os totais das duas faturas", async () => {
    const s = await setup();
    await create(s, { amountCents: 1_000 });
    const moved = await create(s, { amountCents: 4_000 });
    expect(await totals(s)).toEqual({ "2026-12-10": 5_000 });
    at();
    const result = await updateTransaction(
      s.spaceId,
      moved.id,
      entry(s, { amountCents: 4_000, invoiceDueDate: "2027-01-10" }),
    );
    expect(result).toMatchObject({ ok: true, transaction: { invoiceOverridden: true } });
    expect(await totals(s)).toEqual({ "2026-12-10": 1_000, "2027-01-10": 4_000 });
  });

  it("CA4: mover a parcela 2 de 4 leva a 3 e a 4 junto e deixa a 1", async () => {
    const s = await setup();
    const first = await create(s, { amountCents: 40_000, installments: 4 });
    const rows = await groupRows(first.installmentGroupId!);
    expect(rows.map((r) => day(r.invoiceDueDate))).toEqual([
      "2026-12-10",
      "2027-01-10",
      "2027-02-10",
      "2027-03-10",
    ]);
    at();
    const result = await updateTransaction(
      s.spaceId,
      rows[1]!.id,
      entry(s, { amountCents: 10_000, date: "2026-12-08", invoiceDueDate: "2027-02-10" }),
    );
    expect(result.ok).toBe(true);
    const after = await groupRows(first.installmentGroupId!);
    expect(after.map((r) => [day(r.invoiceDueDate), r.invoiceOverridden])).toEqual([
      ["2026-12-10", false],
      ["2027-02-10", true],
      ["2027-03-10", true],
      ["2027-04-10", true],
    ]);
    expect(await totals(s)).toEqual({
      "2026-12-10": 10_000,
      "2027-02-10": 10_000,
      "2027-03-10": 10_000,
      "2027-04-10": 10_000,
    });
  });

  it("CA4: uma fatura fora da janela é recusada e nada muda, nem a categoria", async () => {
    const s = await setup();
    const first = await create(s, { amountCents: 40_000, installments: 4 });
    const rows = await groupRows(first.installmentGroupId!);
    at();
    const result = await updateTransaction(
      s.spaceId,
      rows[1]!.id,
      entry(s, {
        amountCents: 10_000,
        date: "2026-12-08",
        categoryId: null,
        invoiceDueDate: "2027-06-10",
      }),
    );
    expect(result).toEqual({ ok: false, error: "INVALID_INVOICE" });
    const after = await groupRows(first.installmentGroupId!);
    expect(after.map((r) => [day(r.invoiceDueDate), r.categoryId])).toEqual(
      rows.map((r) => [day(r.invoiceDueDate), s.mercado.id]),
    );
  });

  it("CA7: mudar o ciclo não recalcula um grupo trocado à mão; os outros grupos, sim", async () => {
    const s = await setup();
    const moved = await create(s, { amountCents: 20_000, installments: 2 });
    const kept = await create(s, { amountCents: 20_000, installments: 2 });
    const movedRows = await groupRows(moved.installmentGroupId!);
    at();
    const result = await updateTransaction(
      s.spaceId,
      movedRows[1]!.id,
      entry(s, { amountCents: 10_000, date: "2026-12-08", invoiceDueDate: "2027-02-10" }),
    );
    expect(result.ok).toBe(true);
    at();
    await updateCard(
      s.spaceId,
      s.card.id,
      cardSchema.parse({ name: "Cartão Roxo", accountId: s.accountId, closingDay: 20, dueDay: 27 }),
    );
    expect((await groupRows(moved.installmentGroupId!)).map((r) => day(r.invoiceDueDate))).toEqual([
      "2026-12-10",
      "2027-02-10",
    ]);
    expect((await groupRows(kept.installmentGroupId!)).map((r) => day(r.invoiceDueDate))).toEqual([
      "2026-11-27",
      "2026-12-27",
    ]);
  });
});
