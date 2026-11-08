import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { parseFilters } from "@/lib/validation/transaction-filters";
import { cardPaymentSchema, entrySchema, transferSchema } from "@/lib/validation/transactions";
import { createAccount, setAccountArchived } from "@/server/accounts";
import { setCategoryArchived } from "@/server/categories";
import { createCard } from "@/server/cards";
import { ensurePersonalSpace } from "@/server/spaces";
import { PAGE_SIZE, listTransactions } from "@/server/transaction-list";
import {
  accountBalances,
  bulkSetCategory,
  createCardPayment,
  createTransaction,
  createTransfer,
  updateCardPayment,
  updateTransfer,
} from "@/server/transactions";
import { resetDatabase } from "@/test/db";

beforeEach(resetDatabase);
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

let minute = 0;
function tick() {
  vi.useFakeTimers({ toFake: ["Date"] });
  minute += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 8, 15, 0, minute)));
}

async function setup(email = "ana@example.com") {
  tick();
  const user = await db.user.create({ data: { name: "Ana Teste", email } });
  const space = await ensurePersonalSpace(user.id);
  const account = async (name: string) => {
    const result = await createAccount(
      space.id,
      accountSchema.parse({
        name,
        color: "blue",
        initialBalance: "1.000,00",
        initialBalanceDate: "2026-09-30",
      }),
    );
    if (!result.ok) throw new Error(result.error);
    return result.account;
  };
  const azul = await account("Banco Azul");
  const verde = await account("Banco Verde");
  const card = await createCard(
    space.id,
    cardSchema.parse({ name: "Cartão Roxo", accountId: azul.id, closingDay: 3, dueDay: 10 }),
  );
  if (!card.ok) throw new Error(card.error);
  const category = (name: string) =>
    db.category.findFirstOrThrow({ where: { spaceId: space.id, name } });
  return {
    userId: user.id,
    spaceId: space.id,
    azul,
    verde,
    card: card.card,
    alimentacao: await category("Alimentação"),
    mercado: await category("Mercado"),
    lazer: await category("Lazer"),
    salario: await category("Salário"),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function expense(s: Setup, fields: Record<string, unknown> = {}) {
  tick();
  const result = await createTransaction(
    s.spaceId,
    s.userId,
    randomUUID(),
    entrySchema.parse({
      type: "EXPENSE",
      amountCents: 1_000,
      date: "2026-10-20",
      method: "PIX",
      accountId: s.azul.id,
      ...fields,
    }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.transaction;
}

async function transfer(s: Setup, fields: Record<string, unknown> = {}) {
  tick();
  const result = await createTransfer(
    s.spaceId,
    s.userId,
    randomUUID(),
    transferSchema.parse({
      amountCents: 5_000,
      date: "2026-10-21",
      method: "PIX",
      accountId: s.verde.id,
      toAccountId: s.azul.id,
      ...fields,
    }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.transaction;
}

const october = (params: Record<string, string> = {}) =>
  parseFilters({ de: "2026-10-01", ate: "2026-10-31", ...params }, "2026-11-08");

const ids = async (s: Setup, params: Record<string, string> = {}) =>
  (await listTransactions(s.spaceId, october(params))).items.map((i) => i.id);

describe("lista de lançamentos", () => {
  it("CA4: cada filtro", async () => {
    const s = await setup();
    const pao = await expense(s, { categoryId: s.mercado.id, counterparty: "Padaria São João" });
    const cinema = await expense(s, {
      categoryId: s.lazer.id,
      method: "DEBIT",
      accountId: s.verde.id,
    });
    const roxo = await expense(s, { method: "CREDIT", accountId: undefined, cardId: s.card.id });
    const salario = await expense(s, { type: "INCOME", method: "TED", categoryId: s.salario.id });
    const entrada = await transfer(s);
    const setembro = await expense(s, { date: "2026-09-15" });

    expect(new Set(await ids(s))).toEqual(
      new Set([pao.id, cinema.id, roxo.id, salario.id, entrada.id]),
    );
    expect(await ids(s)).not.toContain(setembro.id);
    // An account includes the transfers that come into it.
    expect(new Set(await ids(s, { conta: s.azul.id }))).toEqual(
      new Set([pao.id, salario.id, entrada.id]),
    );
    expect(await ids(s, { cartao: s.card.id })).toEqual([roxo.id]);
    expect(await ids(s, { forma: "DEBIT" })).toEqual([cinema.id]);
    expect(await ids(s, { tipo: "TRANSFER" })).toEqual([entrada.id]);
    // A parent includes its children; "none" is uncategorized expenses and incomes.
    expect(await ids(s, { categoria: s.alimentacao.id })).toEqual([pao.id]);
    expect(await ids(s, { categoria: "none" })).toEqual([roxo.id]);
    expect(await ids(s, { estabelecimento: pao.counterparty!.id })).toEqual([pao.id]);
  });

  it("CA4: busca por nome sem acento, apelido, observação e valor", async () => {
    const s = await setup();
    const pao = await expense(s, {
      counterparty: "Padaria São João",
      counterpartyAlias: "PAG*JOSE SILVA",
    });
    const presente = await expense(s, { description: "Presente da Bia", amountCents: 4_790 });
    expect(await ids(s, { q: "sao joao" })).toEqual([pao.id]);
    expect(await ids(s, { q: "jose" })).toEqual([pao.id]);
    expect(await ids(s, { q: "PRESENTE" })).toEqual([presente.id]);
    expect(await ids(s, { q: "47,90" })).toEqual([presente.id]);
    expect(await ids(s, { q: "nada disso" })).toEqual([]);
  });

  it("CA4: pagina sem repetir nem pular; o total do dia cobre a página seguinte", async () => {
    const s = await setup();
    const created: string[] = [];
    for (let i = 0; i < PAGE_SIZE + 5; i++) {
      created.push((await expense(s, { date: i < 30 ? "2026-10-20" : "2026-10-19" })).id);
    }
    await expense(s, { type: "INCOME", method: "TED", date: "2026-10-19", amountCents: 100_000 });
    await transfer(s, { date: "2026-10-19" });

    const first = await listTransactions(s.spaceId, october());
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = await listTransactions(s.spaceId, october(), first.nextCursor!);
    expect(second.nextCursor).toBeNull();

    const all = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(PAGE_SIZE + 5 + 2);
    // Newest first: date, then registration time.
    expect(all.slice(0, 30)).toEqual(created.slice(0, 30).reverse());
    // 10-19 spans both pages: 25 expenses of R$ 10, an income of R$ 1.000; the transfer doesn't count.
    expect(first.dayTotals["2026-10-19"]).toBe(100_000 - 25 * 1_000);
    expect(first.dayTotals["2026-10-20"]).toBe(-30 * 1_000);
  });

  it("CA4: outro espaço não vê nada; parcelas trazem o total da compra", async () => {
    const ana = await setup();
    const bia = await setup("bia@example.com");
    await expense(ana);
    const parcelada = await expense(ana, {
      method: "CREDIT",
      accountId: undefined,
      cardId: ana.card.id,
      installments: 3,
      amountCents: 30_000,
    });
    expect((await listTransactions(bia.spaceId, october())).items).toEqual([]);
    const item = (await listTransactions(ana.spaceId, october())).items.find(
      (i) => i.id === parcelada.id,
    );
    expect(item).toMatchObject({
      installmentNumber: 1,
      installmentTotal: 3,
      installmentGroupCents: 30_000,
    });
  });
});

describe("categorizar em massa", () => {
  it("CA5: aplica a todos de uma vez", async () => {
    const s = await setup();
    const entries = [await expense(s), await expense(s), await expense(s)];
    expect(
      await bulkSetCategory(
        s.spaceId,
        entries.map((e) => e.id),
        s.mercado.id,
      ),
    ).toEqual({
      ok: true,
      count: 3,
    });
    const rows = await db.transaction.findMany({ where: { id: { in: entries.map((e) => e.id) } } });
    expect(rows.every((r) => r.categoryId === s.mercado.id)).toBe(true);
    expect(await bulkSetCategory(s.spaceId, [entries[0]!.id], null)).toEqual({
      ok: true,
      count: 1,
    });
  });

  it("CA5: recusa outro espaço, tipos misturados, transferência, categoria de outro tipo ou arquivada — e não muda nada", async () => {
    const ana = await setup();
    const bia = await setup("bia@example.com");
    const a = await expense(ana);
    const b = await expense(ana);
    const income = await expense(ana, { type: "INCOME", method: "TED" });
    const t = await transfer(ana);
    const daBia = await expense(bia);

    expect(await bulkSetCategory(ana.spaceId, [a.id, daBia.id], ana.mercado.id)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await bulkSetCategory(ana.spaceId, [a.id, income.id], ana.mercado.id)).toEqual({
      ok: false,
      error: "MIXED_TYPES",
    });
    expect(await bulkSetCategory(ana.spaceId, [a.id, t.id], ana.mercado.id)).toEqual({
      ok: false,
      error: "NOT_CATEGORIZABLE",
    });
    expect(await bulkSetCategory(ana.spaceId, [a.id, b.id], ana.salario.id)).toEqual({
      ok: false,
      error: "CATEGORY_TYPE_MISMATCH",
    });
    expect(await bulkSetCategory(ana.spaceId, [a.id], bia.mercado.id)).toEqual({
      ok: false,
      error: "CATEGORY_NOT_FOUND",
    });
    await setCategoryArchived(ana.spaceId, ana.lazer.id, true);
    expect(await bulkSetCategory(ana.spaceId, [a.id, b.id], ana.lazer.id)).toEqual({
      ok: false,
      error: "CATEGORY_ARCHIVED",
    });
    expect(await db.transaction.count({ where: { categoryId: { not: null } } })).toBe(0);
  });
});

describe("editar transferência e pagamento de fatura", () => {
  it("CA6: transferência: valor, contas e forma mudam; mesma conta é recusada; outro espaço não", async () => {
    const s = await setup();
    const bia = await setup("bia@example.com");
    const t = await transfer(s);
    tick();
    const fields = {
      amountCents: 7_000,
      date: "2026-10-22",
      method: "TED",
      accountId: s.azul.id,
      toAccountId: s.verde.id,
    };
    expect(await updateTransfer(s.spaceId, t.id, transferSchema.parse(fields))).toMatchObject({
      ok: true,
      transaction: {
        amountCents: 7_000,
        accountId: s.azul.id,
        toAccountId: s.verde.id,
        method: "TED",
      },
    });
    const balances = await accountBalances(s.spaceId);
    expect(balances.get(s.azul.id)).toBe(100_000 - 7_000);
    expect(balances.get(s.verde.id)).toBe(100_000 + 7_000);

    expect(
      await updateTransfer(s.spaceId, t.id, {
        ...transferSchema.parse(fields),
        toAccountId: s.azul.id,
      }),
    ).toEqual({ ok: false, error: "SAME_ACCOUNT" });
    expect(await updateTransfer(bia.spaceId, t.id, transferSchema.parse(fields))).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    // An archived account it already had may stay.
    await setAccountArchived(s.spaceId, s.verde.id, true);
    expect(
      await updateTransfer(
        s.spaceId,
        t.id,
        transferSchema.parse({ ...fields, amountCents: 8_000 }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("CA6: pagamento: valor, fatura e conta mudam; o cartão não", async () => {
    const s = await setup();
    tick();
    const paid = await createCardPayment(
      s.spaceId,
      s.userId,
      randomUUID(),
      cardPaymentSchema.parse({
        amountCents: 10_000,
        date: "2026-11-05",
        method: "BOLETO",
        accountId: s.azul.id,
        cardId: s.card.id,
        invoiceDueDate: "2026-11-10",
      }),
    );
    if (!paid.ok) throw new Error(paid.error);
    const fields = {
      amountCents: 12_000,
      date: "2026-11-06",
      method: "PIX",
      accountId: s.verde.id,
      cardId: s.card.id,
      invoiceDueDate: "2026-12-10",
    };
    expect(
      await updateCardPayment(s.spaceId, paid.transaction.id, cardPaymentSchema.parse(fields)),
    ).toMatchObject({
      ok: true,
      transaction: { amountCents: 12_000, accountId: s.verde.id, invoiceDueDate: "2026-12-10" },
    });
    expect(
      await updateCardPayment(
        s.spaceId,
        paid.transaction.id,
        cardPaymentSchema.parse({ ...fields, invoiceDueDate: "2026-12-11" }),
      ),
    ).toEqual({ ok: false, error: "INVALID_INVOICE" });
    expect(
      await updateCardPayment(
        s.spaceId,
        paid.transaction.id,
        cardPaymentSchema.parse({ ...fields, cardId: randomUUID() }),
      ),
    ).toEqual({ ok: false, error: "NOT_EDITABLE" });
  });
});
