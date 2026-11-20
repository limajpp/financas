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
import { paymentMemory } from "@/server/register";
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

const reconcile = (
  s: Setup,
  bank: number,
  expectedDiffCents: number,
  { adjust = true, clientId = randomUUID() }: { adjust?: boolean; clientId?: string } = {},
) =>
  reconcileAccount(s.spaceId, s.userId, s.accountId, bank, { adjust, clientId, expectedDiffCents });

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
    const result = await reconcile(s, 85_000, -5_000);
    expect(result).toMatchObject({
      ok: true,
      reconciled: true,
      adjustment: { amountCents: 5_000 },
    });
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
    // Nor does the method filter take it, nor the register's payment memory.
    const pix = await listTransactions(s.spaceId, {
      from: "2026-11-01",
      to: "2026-11-30",
      method: "PIX",
    });
    expect(pix.items.map((i) => i.adjustment)).toEqual([false]);
  });

  it("I1: o ajuste não vira a forma de pagamento lembrada do registro", async () => {
    const s = await setup();
    const inter = await createAccount(
      s.spaceId,
      accountSchema.parse({
        name: "Banco Inter",
        color: "green",
        initialBalance: "0,00",
        initialBalanceDate: "2026-11-01",
      }),
    );
    if (!inter.ok) throw new Error(inter.error);
    on();
    await createTransaction(
      s.spaceId,
      s.userId,
      randomUUID(),
      entrySchema.parse({
        type: "EXPENSE",
        amountCents: 100,
        date: "2026-11-10",
        method: "DEBIT",
        accountId: inter.account.id,
      }),
    );
    on();
    await reconcile(s, 99_000, -1_000);
    expect(await paymentMemory(s.spaceId, "EXPENSE")).toMatchObject({
      method: "DEBIT",
      accountId: inter.account.id,
    });
  });

  it("CA2: o banco com mais cria uma receita de ajuste; saldos iguais só marcam a conferência", async () => {
    const s = await setup();
    on();
    expect(await reconcile(s, 100_000, 0, { adjust: false })).toEqual({
      ok: true,
      reconciled: true,
      adjustment: null,
    });
    expect(await db.transaction.count()).toBe(0);

    await reconcile(s, 100_123, 123);
    expect(await db.transaction.findFirstOrThrow({ where: { adjustment: true } })).toMatchObject({
      type: "INCOME",
      amountCents: 123,
    });
    expect(await balance(s)).toBe(100_123);
  });

  it("CA3: o mesmo clientId não duplica; sem adjust e com diferença nada é gravado", async () => {
    const s = await setup();
    on();
    expect(await reconcile(s, 90_000, -10_000, { adjust: false })).toEqual({
      ok: true,
      reconciled: false,
      appBalanceCents: 100_000,
    });
    expect(
      (await db.account.findUniqueOrThrow({ where: { id: s.accountId } })).reconciledOn,
    ).toBeNull();

    const clientId = randomUUID();
    const [a, b] = await Promise.all([
      reconcile(s, 90_000, -10_000, { clientId }),
      reconcile(s, 90_000, -10_000, { clientId }),
    ]);
    const again = await reconcile(s, 90_000, -10_000, { clientId });
    // All three answer with the same adjustment (the one a retry waited for, included).
    const ids = [a, b, again].map((r) =>
      r.ok && r.reconciled ? r.adjustment?.id : "not reconciled",
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toEqual(expect.any(String));
    expect(await db.transaction.count({ where: { adjustment: true } })).toBe(1);
    expect(await balance(s)).toBe(90_000);
  });

  it("M1: dois aparelhos conferindo ao mesmo tempo criam um ajuste só", async () => {
    const s = await setup();
    on();
    const [a, b] = await Promise.all([
      reconcile(s, 90_000, -10_000),
      reconcile(s, 90_000, -10_000),
    ]);
    // One closes the difference; the other sees the new balance and writes nothing.
    expect([a, b].filter((r) => r.ok && r.reconciled)).toHaveLength(1);
    expect([a, b].find((r) => r.ok && !r.reconciled)).toMatchObject({ appBalanceCents: 90_000 });
    expect(await db.transaction.count({ where: { adjustment: true } })).toBe(1);
    expect(await balance(s)).toBe(90_000);
  });

  it("I2/I3: se o saldo mudou desde a comparação, nada é gravado e o saldo novo volta", async () => {
    const s = await setup();
    on();
    // The screen compared at R$ 1.000,00 (difference −R$ 100,00); then R$ 100,00 was registered.
    await spend(s, 10_000);
    on();
    expect(await reconcile(s, 90_000, -10_000)).toEqual({
      ok: true,
      reconciled: false,
      appBalanceCents: 90_000,
    });
    expect(await db.transaction.count({ where: { adjustment: true } })).toBe(0);
    expect(await reconcile(s, 90_000, 0, { adjust: false })).toMatchObject({ reconciled: true });
  });

  it("M2: o clientId de um lançamento comum não vira o ajuste", async () => {
    const s = await setup();
    const entry = await spend(s, 100);
    on();
    await expect(reconcile(s, 90_000, -9_900, { clientId: entry.clientId })).rejects.toThrow();
    expect(await db.transaction.count({ where: { adjustment: true } })).toBe(0);
    expect(
      (await db.account.findUniqueOrThrow({ where: { id: s.accountId } })).reconciledOn,
    ).toBeNull();
  });

  it("CA3: conta de outro espaço ou arquivada é recusada", async () => {
    const s = await setup();
    const bia = await setup("bia@example.com");
    const args = { adjust: true, clientId: randomUUID(), expectedDiffCents: 0 };
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
    expect(await compareBalance(s.spaceId, s.accountId, 1)).toEqual({
      ok: false,
      error: "ACCOUNT_ARCHIVED",
    });
    expect(await db.transaction.count()).toBe(0);
  });

  it("CA3: o banco recusa um ajuste com categoria, um estorno de ajuste ou uma transferência", async () => {
    const s = await setup();
    const card = await createCard(
      s.spaceId,
      cardSchema.parse({ name: "Cartão Roxo", accountId: s.accountId, closingDay: 3, dueDay: 10 }),
    );
    if (!card.ok) throw new Error(card.error);
    const other = await createAccount(
      s.spaceId,
      accountSchema.parse({
        name: "Banco Inter",
        color: "green",
        initialBalance: "0,00",
        initialBalanceDate: "2026-11-01",
      }),
    );
    if (!other.ok) throw new Error(other.error);
    const base = {
      spaceId: s.spaceId,
      createdById: s.userId,
      type: "EXPENSE" as const,
      amountCents: 100,
      date: new Date("2026-11-15T00:00:00Z"),
      adjustment: true,
    };
    const refused = (data: Record<string, unknown>) =>
      expect(
        db.transaction.create({ data: { ...base, clientId: randomUUID(), ...data } as never }),
      ).rejects.toThrow(/Transaction_adjustment_check/);
    await refused({ method: "PIX", accountId: s.accountId, categoryId: s.mercado.id });
    // On credit, only an expense with no category: an invoice's opening balance (task 22).
    const credit = {
      method: "CREDIT",
      cardId: card.card.id,
      invoiceDueDate: new Date("2026-12-10T00:00:00Z"),
    };
    await refused({ ...credit, type: "INCOME" });
    await refused({ ...credit, categoryId: s.mercado.id });
    await refused({
      type: "TRANSFER",
      method: "PIX",
      accountId: s.accountId,
      toAccountId: other.account.id,
    });
  });

  it("CA4: o ajuste não se edita nem entra na categorização em massa; a exclusão funciona", async () => {
    const s = await setup();
    on();
    const result = await reconcile(s, 90_000, -10_000);
    const id = result.ok && result.reconciled ? result.adjustment!.id : "";
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
