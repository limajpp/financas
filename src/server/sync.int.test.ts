import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { createAccount, setAccountArchived } from "@/server/accounts";
import { createCard } from "@/server/cards";
import { ensurePersonalSpace } from "@/server/spaces";
import { syncItems } from "@/server/sync";
import * as transactions from "@/server/transactions";
import { resetDatabase } from "@/test/db";

beforeEach(async () => {
  await resetDatabase();
  // Noon in São Paulo (Date only, so Prisma's timers keep working).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(() => db.$disconnect());

async function user(email: string) {
  const row = await db.user.create({ data: { name: "Ana Teste", email } });
  const space = await ensurePersonalSpace(row.id);
  const category = await db.category.findFirstOrThrow({
    where: { spaceId: space.id, type: "EXPENSE", parentId: null },
  });
  return { userId: row.id, spaceId: space.id, categoryId: category.id };
}

async function account(spaceId: string, name = "Banco Azul") {
  const result = await createAccount(
    spaceId,
    accountSchema.parse({
      name,
      color: "blue",
      initialBalance: "1.000,00",
      initialBalanceDate: "2026-10-01",
    }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.account;
}

const expense = (accountId: string, over: Record<string, unknown> = {}) => ({
  clientId: randomUUID(),
  kind: "ENTRY",
  data: {
    type: "EXPENSE",
    amountCents: 4790,
    date: "2026-11-09",
    method: "PIX",
    accountId,
    ...over,
  },
});

const count = (spaceId: string) => db.transaction.count({ where: { spaceId } });

describe("syncItems", () => {
  it("cria os lançamentos da fila, na ordem, com a data do registro", async () => {
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const verde = await account(ana.spaceId, "Banco Verde");
    const items = [
      expense(azul.id, { counterparty: "Padaria Estrela", categoryId: ana.categoryId }),
      {
        clientId: randomUUID(),
        kind: "TRANSFER",
        data: {
          amountCents: 10000,
          date: "2026-11-08",
          method: "PIX",
          accountId: azul.id,
          toAccountId: verde.id,
        },
      },
    ];

    const results = await syncItems(ana.spaceId, ana.userId, items);

    expect(results.map((r) => [r.clientId, r.status])).toEqual([
      [items[0].clientId, "SYNCED"],
      [items[1].clientId, "SYNCED"],
    ]);
    const rows = await db.transaction.findMany({
      where: { spaceId: ana.spaceId },
      orderBy: { amountCents: "asc" },
      include: { counterparty: true },
    });
    expect(rows.map((r) => [r.type, r.amountCents, r.date.toISOString().slice(0, 10)])).toEqual([
      ["EXPENSE", 4790, "2026-11-09"],
      ["TRANSFER", 10000, "2026-11-08"],
    ]);
    expect(rows[0].counterparty?.name).toBe("Padaria Estrela");
    expect(rows[0].createdById).toBe(ana.userId);
    expect(results[0]).toMatchObject({ id: rows[0].id });
  });

  it("o mesmo lote enviado duas vezes, em sequência e em paralelo, não duplica (CA2)", async () => {
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const items = [expense(azul.id, { counterparty: "Padaria Estrela" }), expense(azul.id)];

    const first = await syncItems(ana.spaceId, ana.userId, items);
    const second = await syncItems(ana.spaceId, ana.userId, items);
    expect(second).toEqual(first);
    expect(first.every((r) => r.status === "SYNCED")).toBe(true);
    expect(await count(ana.spaceId)).toBe(2);

    const more = [expense(azul.id, { counterparty: "Mercado Sol" }), expense(azul.id)];
    const [a, b] = await Promise.all([
      syncItems(ana.spaceId, ana.userId, more),
      syncItems(ana.spaceId, ana.userId, more),
    ]);
    expect(a).toEqual(b);
    expect(a.every((r) => r.status === "SYNCED")).toBe(true);
    expect(await count(ana.spaceId)).toBe(4);
    expect(await db.counterparty.count({ where: { spaceId: ana.spaceId } })).toBe(2);
  });

  it("uma compra parcelada da fila cria todas as parcelas uma vez só", async () => {
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const card = await createCard(
      ana.spaceId,
      cardSchema.parse({ name: "Cartão Roxo", accountId: azul.id, closingDay: 5, dueDay: 12 }),
    );
    if (!card.ok) throw new Error(card.error);
    const item = {
      clientId: randomUUID(),
      kind: "ENTRY",
      data: {
        type: "EXPENSE",
        amountCents: 30000,
        date: "2026-11-09",
        method: "CREDIT",
        cardId: card.card.id,
        installments: 3,
      },
    };

    await syncItems(ana.spaceId, ana.userId, [item]);
    const [again] = await syncItems(ana.spaceId, ana.userId, [item]);

    expect(again.status).toBe("SYNCED");
    expect(await count(ana.spaceId)).toBe(3);
  });

  it("um item inválido no meio não impede os outros (CA3)", async () => {
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const arquivada = await account(ana.spaceId, "Banco Velho");
    await setAccountArchived(ana.spaceId, arquivada.id, true);
    const items = [
      expense(azul.id),
      expense(azul.id, { amountCents: 0 }), // schema
      expense(arquivada.id), // domain rule
      expense(azul.id, { date: "2026-11-11" }), // tomorrow
      { clientId: randomUUID(), kind: "CARD_PAYMENT", data: {} },
      { ...expense(azul.id), clientId: "não-é-uuid" },
      expense(azul.id, { amountCents: 1500 }),
    ];

    const results = await syncItems(ana.spaceId, ana.userId, items);

    expect(results.map((r) => r.status)).toEqual([
      "SYNCED",
      "REJECTED",
      "REJECTED",
      "REJECTED",
      "REJECTED",
      "REJECTED",
      "SYNCED",
    ]);
    expect(results.map((r) => r.clientId)).toEqual(items.map((i) => i.clientId));
    expect(results[1]).toMatchObject({
      error: "O valor precisa ser maior que zero.",
      fieldErrors: { amountCents: "O valor precisa ser maior que zero." },
    });
    expect(results[2]).toMatchObject({ fieldErrors: { accountId: expect.any(String) } });
    expect(results[3]).toMatchObject({ fieldErrors: { date: expect.any(String) } });
    expect(results[4]).toMatchObject({ error: "Tipo de lançamento inválido." });
    expect(results[5]).toMatchObject({ error: "Identificador do lançamento inválido." });
    expect(await count(ana.spaceId)).toBe(2);
  });

  it("recusa itens que apontam para conta, cartão ou categoria de outro espaço (CA4)", async () => {
    const ana = await user("ana@example.com");
    const bia = await user("bia@example.com");
    const daAna = await account(ana.spaceId);
    const daBia = await account(bia.spaceId, "Banco da Bia");
    const cartaoDaBia = await createCard(
      bia.spaceId,
      cardSchema.parse({ name: "Cartão da Bia", accountId: daBia.id, closingDay: 5, dueDay: 12 }),
    );
    if (!cartaoDaBia.ok) throw new Error(cartaoDaBia.error);

    const results = await syncItems(ana.spaceId, ana.userId, [
      expense(daBia.id),
      expense(daAna.id, { categoryId: bia.categoryId }),
      expense(daAna.id, { method: "CREDIT", accountId: null, cardId: cartaoDaBia.card.id }),
      {
        clientId: randomUUID(),
        kind: "TRANSFER",
        data: {
          amountCents: 5000,
          date: "2026-11-09",
          method: "PIX",
          accountId: daAna.id,
          toAccountId: daBia.id,
        },
      },
    ]);

    expect(results.map((r) => r.status)).toEqual(["REJECTED", "REJECTED", "REJECTED", "REJECTED"]);
    expect(results.map((r) => "fieldErrors" in r && Object.keys(r.fieldErrors ?? {}))).toEqual([
      ["accountId"],
      ["categoryId"],
      ["cardId"],
      ["toAccountId"],
    ]);
    expect(await count(ana.spaceId)).toBe(0);
    expect(await count(bia.spaceId)).toBe(0);
  });

  it("o clientId de um lançamento de outro espaço não devolve o lançamento de lá (CA4)", async () => {
    const ana = await user("ana@example.com");
    const bia = await user("bia@example.com");
    const daAna = await account(ana.spaceId);
    const daBia = await account(bia.spaceId, "Banco da Bia");
    const item = expense(daBia.id);
    const [fromBia] = await syncItems(bia.spaceId, bia.userId, [item]);

    const [fromAna] = await syncItems(ana.spaceId, ana.userId, [
      { ...item, data: { ...item.data, accountId: daAna.id } },
    ]);

    expect(fromAna.status).toBe("SYNCED");
    expect(fromAna).not.toMatchObject({ id: (fromBia as { id: string }).id });
    expect(await count(ana.spaceId)).toBe(1);
    expect(await count(bia.spaceId)).toBe(1);
  });

  it("um erro inesperado em um item vira RETRY e os outros seguem", async () => {
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const items = [expense(azul.id), expense(azul.id), expense(azul.id)];
    const real = transactions.createTransaction;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(transactions, "createTransaction").mockImplementation((...args) => {
      if (args[2] === items[1].clientId) throw new Error("banco fora do ar");
      return real(...args);
    });

    const results = await syncItems(ana.spaceId, ana.userId, items);

    expect(results.map((r) => r.status)).toEqual(["SYNCED", "RETRY", "SYNCED"]);
    expect(await count(ana.spaceId)).toBe(2);
  });
});
