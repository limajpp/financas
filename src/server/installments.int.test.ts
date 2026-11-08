import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { entrySchema } from "@/lib/validation/transactions";
import { createAccount } from "@/server/accounts";
import { createCard, updateCard } from "@/server/cards";
import { categoryUsage, registerData } from "@/server/register";
import { ensurePersonalSpace } from "@/server/spaces";
import {
  accountBalances,
  cardInvoices,
  createTransaction,
  deleteTransaction,
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
  // Closes on the 3rd, due on the 10th.
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
  const mercado = await db.category.findFirstOrThrow({
    where: { spaceId: space.id, name: "Mercado" },
  });
  const lazer = await db.category.findFirstOrThrow({ where: { spaceId: space.id, name: "Lazer" } });
  return {
    userId: user.id,
    spaceId: space.id,
    accountId: account.account.id,
    card: card.card,
    mercado,
    lazer,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const purchase = (s: Setup, fields: Record<string, unknown> = {}) =>
  entrySchema.parse({
    type: "EXPENSE",
    amountCents: 30_001,
    date: "2026-11-08",
    method: "CREDIT",
    cardId: s.card.id,
    categoryId: s.mercado.id,
    counterparty: "Loja de Móveis",
    installments: 3,
    ...fields,
  });

async function buy(s: Setup, fields: Record<string, unknown> = {}, clientId = randomUUID()) {
  at();
  const result = await createTransaction(s.spaceId, s.userId, clientId, purchase(s, fields));
  if (!result.ok) throw new Error(result.error);
  return result.transaction;
}

const groupRows = (groupId: string) =>
  db.transaction.findMany({
    where: { installmentGroupId: groupId },
    orderBy: { installmentNumber: "asc" },
  });

const day = (d: Date | null) => d?.toISOString().slice(0, 10);

describe("compras parceladas", () => {
  it("CA5: 3× grava 3 parcelas com valores, datas e faturas; o saldo não muda", async () => {
    const s = await setup();
    const first = await buy(s);
    expect(first).toMatchObject({ installmentNumber: 1, installmentTotal: 3, amountCents: 10_001 });

    const rows = await groupRows(first.installmentGroupId!);
    expect(
      rows.map((r) => [r.installmentNumber, r.amountCents, day(r.date), day(r.invoiceDueDate)]),
    ).toEqual([
      [1, 10_001, "2026-11-08", "2026-12-10"],
      [2, 10_000, "2026-12-08", "2027-01-10"],
      [3, 10_000, "2027-01-08", "2027-02-10"],
    ]);
    expect(rows.every((r) => r.categoryId === s.mercado.id && r.counterpartyId)).toBe(true);
    expect(new Set(rows.map((r) => r.clientId)).size).toBe(3);

    expect((await accountBalances(s.spaceId)).get(s.accountId)).toBe(100_000);
    expect(
      (await cardInvoices(s.spaceId, s.card.id))?.invoices.map((i) => [
        i.dueDate,
        i.totalCents,
        i.status,
      ]),
    ).toEqual([
      ["2026-12-10", 10_001, "open"],
      ["2027-01-10", 10_000, "future"],
      ["2027-02-10", 10_000, "future"],
    ]);
  });

  it("CA5: o mesmo clientId, em sequência e em paralelo, não duplica a compra", async () => {
    const s = await setup();
    const clientId = randomUUID();
    const first = await buy(s, {}, clientId);
    const again = await createTransaction(s.spaceId, s.userId, clientId, purchase(s));
    expect(again).toMatchObject({ ok: true, created: false, transaction: { id: first.id } });

    const racing = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        createTransaction(s.spaceId, s.userId, racing, purchase(s, { installments: 5 })),
      ),
    );
    expect(results.filter((r) => r.ok && r.created)).toHaveLength(1);
    expect(await db.transaction.count()).toBe(3 + 5);
  });

  it("CA5: outro espaço não edita nem exclui uma parcela", async () => {
    const ana = await setup();
    const bia = await setup("bia@example.com");
    const first = await buy(ana);
    expect(await deleteTransaction(bia.spaceId, first.id, "following")).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(
      await updateTransaction(
        bia.spaceId,
        first.id,
        purchase(bia, { installments: null }),
        "following",
      ),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await db.transaction.count({ where: { spaceId: ana.spaceId } })).toBe(3);
  });

  it("recusa valor pequeno demais e o banco recusa uma parcela solta", async () => {
    const s = await setup();
    expect(
      await createTransaction(
        s.spaceId,
        s.userId,
        randomUUID(),
        purchase(s, { amountCents: 5, installments: 10 }),
      ),
    ).toEqual({ ok: false, error: "TOO_SMALL_FOR_INSTALLMENTS" });
    await expect(
      db.transaction.create({
        data: {
          spaceId: s.spaceId,
          clientId: randomUUID(),
          createdById: s.userId,
          type: "EXPENSE",
          method: "CREDIT",
          amountCents: 100,
          date: new Date("2026-11-08"),
          cardId: s.card.id,
          invoiceDueDate: new Date("2026-12-10"),
          installmentGroupId: randomUUID(),
          installmentNumber: 4,
          installmentTotal: 3,
        },
      }),
    ).rejects.toThrow();
  });

  it("CA6: excluir 'esta e as próximas' mantém as anteriores; 'só esta' exclui só ela", async () => {
    const s = await setup();
    const first = await buy(s, { installments: 5, amountCents: 50_000 });
    const rows = await groupRows(first.installmentGroupId!);

    expect(await deleteTransaction(s.spaceId, rows[2]!.id, "following")).toEqual({
      ok: true,
      count: 3,
    });
    expect((await groupRows(first.installmentGroupId!)).map((r) => r.installmentNumber)).toEqual([
      1, 2,
    ]);

    expect(await deleteTransaction(s.spaceId, rows[0]!.id, "this")).toEqual({ ok: true, count: 1 });
    const left = await groupRows(first.installmentGroupId!);
    expect(left.map((r) => [r.installmentNumber, r.installmentTotal])).toEqual([[2, 5]]);
  });

  it("CA6: editar com 'esta e as próximas' muda da parcela em diante; data e cartão são travados", async () => {
    const s = await setup();
    const first = await buy(s, { installments: 4, amountCents: 40_000 });
    const rows = await groupRows(first.installmentGroupId!);
    const second = rows[1]!;
    const edit = (fields: Record<string, unknown>) =>
      purchase(s, {
        installments: null,
        amountCents: second.amountCents,
        date: day(second.date),
        categoryId: s.lazer.id,
        description: "Sofá",
        ...fields,
      });

    expect(await updateTransaction(s.spaceId, second.id, edit({}), "following")).toMatchObject({
      ok: true,
      transaction: { categoryId: s.lazer.id, description: "Sofá" },
    });
    expect((await groupRows(first.installmentGroupId!)).map((r) => r.categoryId)).toEqual([
      s.mercado.id,
      s.lazer.id,
      s.lazer.id,
      s.lazer.id,
    ]);

    // The amount changes only with "só esta".
    expect(
      await updateTransaction(s.spaceId, second.id, edit({ amountCents: 10_500 }), "following"),
    ).toEqual({ ok: false, error: "INSTALLMENT_AMOUNT_SCOPE" });
    expect(
      await updateTransaction(s.spaceId, second.id, edit({ amountCents: 10_500 }), "this"),
    ).toMatchObject({ ok: true, transaction: { amountCents: 10_500 } });
    expect((await groupRows(first.installmentGroupId!))[2]!.amountCents).toBe(10_000);

    for (const locked of [{ date: "2026-12-01" }, { method: "PIX", accountId: s.accountId }]) {
      expect(await updateTransaction(s.spaceId, second.id, edit(locked), "this")).toEqual({
        ok: false,
        error: "INSTALLMENT_LOCKED",
      });
    }
  });

  it("uma compra à vista não vira parcelada na edição", async () => {
    const s = await setup();
    const single = await buy(s, { installments: null });
    expect(await updateTransaction(s.spaceId, single.id, purchase(s, { installments: 3 }))).toEqual(
      { ok: false, error: "INSTALLMENTS_ON_EDIT" },
    );
  });

  it("CA7: mudar o ciclo refaz as faturas das parcelas que ainda não venceram e mantém as anteriores", async () => {
    const s = await setup();
    at("2026-09-15");
    const first = await createTransaction(
      s.spaceId,
      s.userId,
      randomUUID(),
      purchase(s, { date: "2026-09-15", installments: 4, amountCents: 40_000 }),
    );
    if (!first.ok) throw new Error(first.error);
    // Due 10/10, 10/11, 10/12, 10/01.
    at("2026-11-12");
    await updateCard(
      s.spaceId,
      s.card.id,
      cardSchema.parse({ name: "Cartão Roxo", accountId: s.accountId, closingDay: 20, dueDay: 27 }),
    );
    expect(
      (await groupRows(first.transaction.installmentGroupId!)).map((r) => day(r.invoiceDueDate)),
    ).toEqual(["2026-10-10", "2026-11-10", "2026-11-27", "2026-12-27"]);
  });

  it("CA8: uma compra de 10× conta uma vez nas categorias mais usadas e na memória", async () => {
    const s = await setup();
    await buy(s, { installments: 10, amountCents: 100_000 });
    expect(await categoryUsage(s.spaceId, "EXPENSE")).toMatchObject([
      { categoryId: s.mercado.id, count: 1 },
    ]);
    const memory = (await registerData(s.spaceId)).counterparties;
    expect(memory).toMatchObject([{ name: "Loja de Móveis", useCount: 1, recentCount: 1 }]);
  });
});
