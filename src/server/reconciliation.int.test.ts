import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { incomeByCategory, spendingByCategory } from "@/domain/totals";
import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { entrySchema } from "@/lib/validation/transactions";
import { createAccount, setAccountArchived } from "@/server/accounts";
import { createCard } from "@/server/cards";
import { compareBalance, reconcileAccount } from "@/server/reconciliation";
import { ensurePersonalSpace } from "@/server/spaces";
import { listTransactions } from "@/server/transaction-list";
import {
  accountBalances,
  bulkSetCategory,
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from "@/server/transactions";
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

async function setup(email = "ana@example.com") {
  on();
  const user = await db.user.create({ data: { name: "Ana Teste", email } });
  const space = await ensurePersonalSpace(user.id);
  const account = await createAccount(
    space.id,
    accountSchema.parse({
      name: "Banco Azul",
      color: "blue",
      initialBalance: "1.000,00",
      initialBalanceDate: "2026-11-01",
    }),
  );
  if (!account.ok) throw new Error(account.error);
  const mercado = await db.category.findFirstOrThrow({
    where: { spaceId: space.id, name: "Mercado" },
  });
  return { userId: user.id, spaceId: space.id, accountId: account.account.id, mercado };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function spend(s: Setup, amountCents: number) {
  on();
  const result = await createTransaction(
    s.spaceId,
    s.userId,
    randomUUID(),
    entrySchema.parse({
      type: "EXPENSE",
      amountCents,
      date: "2026-11-10",
      method: "PIX",
      accountId: s.accountId,
      categoryId: s.mercado.id,
    }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.transaction;
}

const balance = async (s: Setup) => (await accountBalances(s.spaceId)).get(s.accountId);

describe("conferir saldo", () => {
  it("compara sem gravar nada e traz os últimos lançamentos", async () => {
    const s = await setup();
    await spend(s, 10_000);
    on();
    const result = await compareBalance(s.spaceId, s.accountId, 85_000);
    expect(result).toMatchObject({
      ok: true,
      appBalanceCents: 90_000,
      bankBalanceCents: 85_000,
      diffCents: -5_000,
      direction: "MISSING_EXPENSE",
    });
    expect(result.ok && result.entries).toHaveLength(1);
    expect(await db.account.findUniqueOrThrow({ where: { id: s.accountId } })).toMatchObject({
      reconciledOn: null,
    });
  });

  it("CA2: o ajuste zera a diferença, grava a conferência e fica fora dos indicadores", async () => {
    const s = await setup();
    await spend(s, 10_000);
    on();
    const result = await reconcileAccount(s.spaceId, s.userId, s.accountId, 85_000, {
      adjust: true,
      clientId: randomUUID(),
    });
    expect(result).toMatchObject({ ok: true, reconciled: true, diffCents: -5_000 });
    expect(await balance(s)).toBe(85_000);
    const account = await db.account.findUniqueOrThrow({ where: { id: s.accountId } });
    expect(account.reconciledOn?.toISOString().slice(0, 10)).toBe("2026-11-15");
    expect(account.reconciledBalanceCents).toBe(85_000);

    const adjustment = await db.transaction.findFirstOrThrow({ where: { adjustment: true } });
    expect(adjustment).toMatchObject({
      type: "EXPENSE",
      amountCents: 5_000,
      categoryId: null,
      counterpartyId: null,
      description: "Ajuste da conferência de saldo",
    });

    const rows = await db.transaction.findMany({ where: { spaceId: s.spaceId } });
    expect(spendingByCategory(rows)).toEqual(new Map([[s.mercado.id, 10_000]]));
    expect(incomeByCategory(rows)).toEqual(new Map());
    const page = await listTransactions(s.spaceId, { from: "2026-11-01", to: "2026-11-30" });
    expect(page.dayTotals).toEqual({ "2026-11-10": -10_000, "2026-11-15": 0 });
  });

  it("CA2: o banco com mais cria uma receita de ajuste; saldos iguais só marcam a conferência", async () => {
    const s = await setup();
    on();
    expect(
      await reconcileAccount(s.spaceId, s.userId, s.accountId, 100_000, {
        adjust: false,
        clientId: randomUUID(),
      }),
    ).toEqual({ ok: true, reconciled: true, diffCents: 0, adjustmentId: null });
    expect(await db.transaction.count()).toBe(0);

    await reconcileAccount(s.spaceId, s.userId, s.accountId, 100_123, {
      adjust: true,
      clientId: randomUUID(),
    });
    expect(await db.transaction.findFirstOrThrow({ where: { adjustment: true } })).toMatchObject({
      type: "INCOME",
      amountCents: 123,
    });
    expect(await balance(s)).toBe(100_123);
  });

  it("CA3: o mesmo clientId não duplica; sem adjust e com diferença nada é gravado", async () => {
    const s = await setup();
    on();
    expect(
      await reconcileAccount(s.spaceId, s.userId, s.accountId, 90_000, {
        adjust: false,
        clientId: randomUUID(),
      }),
    ).toEqual({ ok: true, reconciled: false, diffCents: -10_000, adjustmentId: null });
    expect(
      (await db.account.findUniqueOrThrow({ where: { id: s.accountId } })).reconciledOn,
    ).toBeNull();

    const clientId = randomUUID();
    const [a, b] = await Promise.all([
      reconcileAccount(s.spaceId, s.userId, s.accountId, 90_000, { adjust: true, clientId }),
      reconcileAccount(s.spaceId, s.userId, s.accountId, 90_000, { adjust: true, clientId }),
    ]);
    const again = await reconcileAccount(s.spaceId, s.userId, s.accountId, 90_000, {
      adjust: true,
      clientId,
    });
    expect(a.ok && b.ok && again.ok).toBe(true);
    expect(await db.transaction.count({ where: { adjustment: true } })).toBe(1);
    expect(await balance(s)).toBe(90_000);
  });

  it("CA3: conta de outro espaço ou arquivada é recusada", async () => {
    const s = await setup();
    const bia = await setup("bia@example.com");
    const args = { adjust: true, clientId: randomUUID() };
    expect(await reconcileAccount(bia.spaceId, bia.userId, s.accountId, 1, args)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await compareBalance(bia.spaceId, s.accountId, 1)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    await setAccountArchived(s.spaceId, s.accountId, true);
    expect(await reconcileAccount(s.spaceId, s.userId, s.accountId, 1, args)).toEqual({
      ok: false,
      error: "ACCOUNT_ARCHIVED",
    });
    expect(await db.transaction.count()).toBe(0);
  });

  it("CA3: o banco recusa um ajuste com categoria ou no crédito", async () => {
    const s = await setup();
    const card = await createCard(
      s.spaceId,
      cardSchema.parse({ name: "Cartão Roxo", accountId: s.accountId, closingDay: 3, dueDay: 10 }),
    );
    if (!card.ok) throw new Error(card.error);
    const base = {
      spaceId: s.spaceId,
      createdById: s.userId,
      type: "EXPENSE" as const,
      amountCents: 100,
      date: new Date("2026-11-15T00:00:00Z"),
      adjustment: true,
    };
    await expect(
      db.transaction.create({
        data: {
          ...base,
          clientId: randomUUID(),
          method: "PIX",
          accountId: s.accountId,
          categoryId: s.mercado.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.transaction.create({
        data: {
          ...base,
          clientId: randomUUID(),
          method: "CREDIT",
          cardId: card.card.id,
          invoiceDueDate: new Date("2026-12-10T00:00:00Z"),
        },
      }),
    ).rejects.toThrow();
  });

  it("CA4: o ajuste não se edita nem entra na categorização em massa; a exclusão funciona", async () => {
    const s = await setup();
    on();
    const result = await reconcileAccount(s.spaceId, s.userId, s.accountId, 90_000, {
      adjust: true,
      clientId: randomUUID(),
    });
    const id = result.ok ? result.adjustmentId! : "";
    expect(
      await updateTransaction(
        s.spaceId,
        id,
        entrySchema.parse({
          type: "EXPENSE",
          amountCents: 1,
          date: "2026-11-15",
          method: "PIX",
          accountId: s.accountId,
        }),
      ),
    ).toEqual({ ok: false, error: "ADJUSTMENT_LOCKED" });
    expect(await bulkSetCategory(s.spaceId, [id], s.mercado.id)).toEqual({
      ok: false,
      error: "NOT_CATEGORIZABLE",
    });
    const uncategorized = await listTransactions(s.spaceId, {
      from: "2026-11-01",
      to: "2026-11-30",
      categoryId: "none",
    });
    expect(uncategorized.items).toEqual([]);

    expect(await deleteTransaction(s.spaceId, id)).toEqual({ ok: true, count: 1 });
    expect(await balance(s)).toBe(100_000);
    // The reconciliation date stays.
    expect(
      (await db.account.findUniqueOrThrow({ where: { id: s.accountId } })).reconciledOn,
    ).not.toBeNull();
  });
});
