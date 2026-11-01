import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { entrySchema } from "@/lib/validation/transactions";
import { createAccount, setAccountArchived } from "@/server/accounts";
import { createCard } from "@/server/cards";
import { categoryUsage, paymentMemory, registerData } from "@/server/register";
import { ensurePersonalSpace } from "@/server/spaces";
import { createTransaction } from "@/server/transactions";
import { resetDatabase } from "@/test/db";

beforeEach(resetDatabase);
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

function today(date: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T15:00:00Z`));
}

async function user(email: string) {
  const row = await db.user.create({ data: { name: "Ana Teste", email } });
  const space = await ensurePersonalSpace(row.id);
  return { userId: row.id, spaceId: space.id };
}

async function account(spaceId: string, name: string) {
  const result = await createAccount(
    spaceId,
    accountSchema.parse({
      name,
      color: "blue",
      initialBalance: "0",
      initialBalanceDate: "2026-01-01",
    }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.account;
}

const category = (spaceId: string, name: string) =>
  db.category.findFirstOrThrow({ where: { spaceId, name } });

async function create(owner: { spaceId: string; userId: string }, fields: Record<string, unknown>) {
  const result = await createTransaction(
    owner.spaceId,
    owner.userId,
    randomUUID(),
    entrySchema.parse({ type: "EXPENSE", amountCents: 1_000, date: "2026-10-20", ...fields }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.transaction;
}

describe("registro", () => {
  it("CA8: o uso das categorias conta só os últimos 90 dias e só o espaço", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const bia = await user("bia@example.com");
    const azul = await account(ana.spaceId, "Banco Azul");
    const contaDaBia = await account(bia.spaceId, "Banco Azul");
    const mercado = await category(ana.spaceId, "Mercado");
    const lazer = await category(ana.spaceId, "Lazer");
    const mercadoDaBia = await category(bia.spaceId, "Mercado");

    const pix = { method: "PIX", accountId: azul.id };
    await create(ana, { ...pix, categoryId: mercado.id, date: "2026-08-02" }); // 90 days ago: in
    await create(ana, { ...pix, categoryId: mercado.id, date: "2026-10-30" });
    await create(ana, { ...pix, categoryId: lazer.id, date: "2026-08-01" }); // 91 days ago: out
    await create(ana, { ...pix, categoryId: null });
    await create(bia, { method: "PIX", accountId: contaDaBia.id, categoryId: mercadoDaBia.id });

    const usage = await categoryUsage(ana.spaceId, "EXPENSE");
    expect(usage).toEqual([{ categoryId: mercado.id, count: 2, lastUsedAt: expect.any(Date) }]);

    const data = await registerData(ana.spaceId);
    expect(data.EXPENSE.top[0]).toMatchObject({ id: mercado.id, name: "Mercado" });
    expect(data.EXPENSE.top).toHaveLength(5);
    expect(data.INCOME.top.every((c) => c.id !== mercado.id)).toBe(true);
  });

  it("CA8: o último uso é por tipo; o cartão lembrado vem da última compra no crédito", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId, "Banco Azul");
    const inter = await account(ana.spaceId, "Banco Inter");
    const card = await createCard(
      ana.spaceId,
      cardSchema.parse({ name: "Cartão Roxo", accountId: azul.id, closingDay: 5, dueDay: 12 }),
    );
    if (!card.ok) throw new Error(card.error);

    expect(await paymentMemory(ana.spaceId, "EXPENSE")).toEqual({
      method: null,
      accountId: null,
      cardId: null,
    });

    // One minute apart: "last" goes by creation time.
    const later = (minutes: number) =>
      vi.setSystemTime(new Date(`2026-10-31T15:${String(minutes).padStart(2, "0")}:00Z`));
    later(1);
    await create(ana, { method: "DEBIT", accountId: inter.id });
    later(2);
    await create(ana, { method: "CREDIT", cardId: card.card.id });
    later(3);
    await create(ana, { type: "INCOME", method: "TED", accountId: azul.id });

    expect(await paymentMemory(ana.spaceId, "EXPENSE")).toEqual({
      method: "CREDIT",
      accountId: inter.id,
      cardId: card.card.id,
    });
    expect(await paymentMemory(ana.spaceId, "INCOME")).toEqual({
      method: "TED",
      accountId: azul.id,
      cardId: null,
    });

    const data = await registerData(ana.spaceId);
    expect(data.EXPENSE.payment).toEqual({
      method: "CREDIT",
      accountId: inter.id,
      cardId: card.card.id,
    });
    expect(data.INCOME.payment).toEqual({
      method: "TED",
      accountId: azul.id,
      cardId: card.card.id,
    });

    // Inter archived: the expense falls back to the first active account.
    await setAccountArchived(ana.spaceId, inter.id, true);
    expect((await registerData(ana.spaceId)).EXPENSE.payment?.accountId).toBe(azul.id);
    expect((await registerData(ana.spaceId)).accounts.map((a) => a.name)).toEqual(["Banco Azul"]);
  });

  it("sem conta ativa, não há pagamento padrão", async () => {
    const ana = await user("ana@example.com");
    const data = await registerData(ana.spaceId);
    expect(data.accounts).toEqual([]);
    expect(data.EXPENSE.payment).toBeNull();
    // Without usage, the parents in the default list's order.
    expect(data.EXPENSE.top.map((c) => c.name)).toEqual([
      "Moradia",
      "Alimentação",
      "Transporte",
      "Saúde",
      "Educação",
    ]);
  });
});
