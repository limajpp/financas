import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accountBalance } from "@/domain/balance";
import { calendarDateToDb } from "@/domain/dates";
import type { EntryInput } from "@/domain/transactions";
import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { entrySchema } from "@/lib/validation/transactions";
import { createAccount, setAccountArchived } from "@/server/accounts";
import { createCard, setCardArchived, updateCard } from "@/server/cards";
import { setCategoryArchived } from "@/server/categories";
import { ensurePersonalSpace } from "@/server/spaces";
import {
  accountBalances,
  createTransaction,
  deleteTransaction,
  updateTransaction,
} from "@/server/transactions";
import { resetDatabase } from "@/test/db";

beforeEach(resetDatabase);
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

/** Freezes "now" (Date only, so Prisma's timers keep working) at noon in São Paulo. */
function today(date: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T15:00:00Z`));
}

async function user(email: string) {
  const row = await db.user.create({ data: { name: "Ana Teste", email } });
  const space = await ensurePersonalSpace(row.id);
  const category = (type: "EXPENSE" | "INCOME") =>
    db.category.findFirstOrThrow({ where: { spaceId: space.id, type, parentId: null } });
  return {
    userId: row.id,
    spaceId: space.id,
    expenseCategory: await category("EXPENSE"),
    incomeCategory: await category("INCOME"),
  };
}

async function account(spaceId: string, name = "Banco Azul", initial = "1.000,00") {
  const result = await createAccount(
    spaceId,
    accountSchema.parse({
      name,
      color: "blue",
      initialBalance: initial,
      initialBalanceDate: "2026-10-01",
    }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.account;
}

/** Closes on the 5th, due on the 12th. */
async function card(spaceId: string, accountId: string) {
  const result = await createCard(
    spaceId,
    cardSchema.parse({ name: "Cartão Roxo", accountId, closingDay: 5, dueDay: 12 }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.card;
}

const entry = (fields: Record<string, unknown>): EntryInput =>
  entrySchema.parse({ type: "EXPENSE", amountCents: 1_000, date: "2026-10-20", ...fields });

async function create(
  owner: { spaceId: string; userId: string },
  fields: Record<string, unknown>,
  clientId = randomUUID(),
) {
  const result = await createTransaction(owner.spaceId, owner.userId, clientId, entry(fields));
  if (!result.ok) throw new Error(result.error);
  return result.transaction;
}

describe("lançamentos", () => {
  it("cria uma despesa no Pix com estabelecimento, e o saldo cai", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);

    const result = await createTransaction(
      ana.spaceId,
      ana.userId,
      randomUUID(),
      entry({
        method: "PIX",
        accountId: azul.id,
        amountCents: 2_550,
        categoryId: ana.expenseCategory.id,
        counterparty: "Padaria do Bairro",
        description: "Pão e café",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      created: true,
      transaction: {
        type: "EXPENSE",
        method: "PIX",
        amountCents: 2_550,
        date: "2026-10-20",
        accountId: azul.id,
        cardId: null,
        invoiceDueDate: null,
        counterparty: { name: "Padaria do Bairro" },
        description: "Pão e café",
      },
    });
    expect((await accountBalances(ana.spaceId)).get(azul.id)).toBe(100_000 - 2_550);
  });

  it("CA1: a compra no crédito não reduz o saldo; o pagamento da fatura reduz", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const roxo = await card(ana.spaceId, azul.id);

    await create(ana, { method: "CREDIT", cardId: roxo.id, amountCents: 30_000 });
    expect((await accountBalances(ana.spaceId)).get(azul.id)).toBe(100_000);

    // Invoice payments are created by task 11; the balance already counts them.
    await db.transaction.create({
      data: {
        spaceId: ana.spaceId,
        clientId: randomUUID(),
        createdById: ana.userId,
        type: "CARD_PAYMENT",
        method: "PIX",
        amountCents: 30_000,
        date: calendarDateToDb("2026-10-25"),
        accountId: azul.id,
        cardId: roxo.id,
        invoiceDueDate: calendarDateToDb("2026-11-12"),
      },
    });
    expect((await accountBalances(ana.spaceId)).get(azul.id)).toBe(70_000);
  });

  it("CA2 e CA7: o saldo conta só depois da data do saldo inicial e bate com o módulo", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId); // R$ 1.000,00 on 2026-10-01
    const verde = await account(ana.spaceId, "Banco Verde", "0");
    const roxo = await card(ana.spaceId, azul.id);

    await create(ana, { method: "PIX", accountId: azul.id, date: "2026-09-30", amountCents: 1 });
    await create(ana, { method: "PIX", accountId: azul.id, date: "2026-10-01", amountCents: 10 });
    await create(ana, {
      method: "DEBIT",
      accountId: azul.id,
      date: "2026-10-02",
      amountCents: 100,
    });
    await create(ana, {
      type: "INCOME",
      method: "TED",
      accountId: azul.id,
      date: "2026-10-05",
      amountCents: 500_000,
    });
    await create(ana, {
      method: "CREDIT",
      cardId: roxo.id,
      date: "2026-10-10",
      amountCents: 7_000,
    });
    await create(ana, { method: "PIX", accountId: verde.id, amountCents: 2_000 });

    const balances = await accountBalances(ana.spaceId);
    expect(balances.get(azul.id)).toBe(100_000 - 100 + 500_000);
    expect(balances.get(verde.id)).toBe(-2_000);

    const rows = await db.transaction.findMany({ where: { spaceId: ana.spaceId } });
    const entries = rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) }));
    expect(balances.get(azul.id)).toBe(
      accountBalance({ ...azul, initialBalanceDate: "2026-10-01" }, entries, "2026-10-31"),
    );
  });

  it("CA3: o mesmo clientId não duplica, em sequência nem em paralelo", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const fields = { method: "PIX", accountId: azul.id, counterparty: "Mercado Central" };

    const clientId = randomUUID();
    const first = await createTransaction(ana.spaceId, ana.userId, clientId, entry(fields));
    const again = await createTransaction(
      ana.spaceId,
      ana.userId,
      clientId,
      entry({ ...fields, amountCents: 9_999 }),
    );
    expect(first).toMatchObject({ ok: true, created: true });
    expect(again).toMatchObject({ ok: true, created: false, transaction: { amountCents: 1_000 } });
    if (!first.ok || !again.ok) throw new Error("unreachable");
    expect(again.transaction.id).toBe(first.transaction.id);

    const racing = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createTransaction(
          ana.spaceId,
          ana.userId,
          racing,
          entry({ ...fields, counterparty: "Feira Nova" }),
        ),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.ok && r.transaction.id)).size).toBe(1);

    expect(await db.transaction.count()).toBe(2);
    expect(await db.counterparty.count()).toBe(2);
  });

  it("CA3: o mesmo clientId em outro espaço cria normalmente", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const bia = await user("bia@example.com");
    const contaDaAna = await account(ana.spaceId);
    const contaDaBia = await account(bia.spaceId);
    const clientId = randomUUID();

    await create(ana, { method: "PIX", accountId: contaDaAna.id }, clientId);
    const result = await createTransaction(
      bia.spaceId,
      bia.userId,
      clientId,
      entry({ method: "PIX", accountId: contaDaBia.id }),
    );
    expect(result).toMatchObject({ ok: true, created: true });
    expect(await db.transaction.count()).toBe(2);
  });

  it("um estabelecimento por nome, sem diferença de maiúsculas e acentos; nomes simultâneos viram um", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);

    const first = await create(ana, {
      method: "PIX",
      accountId: azul.id,
      counterparty: "Padaria São João",
    });
    const second = await create(ana, {
      method: "PIX",
      accountId: azul.id,
      counterparty: "padaria sao  joao",
    });
    expect(second.counterparty).toEqual(first.counterparty);
    expect(second.counterparty?.name).toBe("Padaria São João");

    await Promise.all(
      Array.from({ length: 5 }, () =>
        create(ana, { method: "PIX", accountId: azul.id, counterparty: "Açougue" }),
      ),
    );
    expect(await db.counterparty.count({ where: { spaceId: ana.spaceId } })).toBe(2);
  });

  it("CA4: um usuário não lê, edita nem exclui lançamento de outro espaço", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const bia = await user("bia@example.com");
    const contaDaAna = await account(ana.spaceId);
    const contaDaBia = await account(bia.spaceId);
    const daAna = await create(ana, { method: "PIX", accountId: contaDaAna.id });

    expect(
      await updateTransaction(
        bia.spaceId,
        daAna.id,
        entry({ method: "PIX", accountId: contaDaBia.id, amountCents: 1 }),
      ),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await deleteTransaction(bia.spaceId, daAna.id)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    // Bia's balances don't see Ana's entries.
    expect((await accountBalances(bia.spaceId)).get(contaDaAna.id)).toBeUndefined();
    expect(await db.transaction.findUniqueOrThrow({ where: { id: daAna.id } })).toMatchObject({
      amountCents: 1_000,
      accountId: contaDaAna.id,
    });
  });

  it("CA4: não usa conta, cartão nem categoria de outro espaço", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const bia = await user("bia@example.com");
    const contaDaAna = await account(ana.spaceId);
    const cartaoDaAna = await card(ana.spaceId, contaDaAna.id);
    const contaDaBia = await account(bia.spaceId);
    const attempt = (fields: Record<string, unknown>) =>
      createTransaction(bia.spaceId, bia.userId, randomUUID(), entry(fields));

    expect(await attempt({ method: "PIX", accountId: contaDaAna.id })).toEqual({
      ok: false,
      error: "ACCOUNT_NOT_FOUND",
    });
    expect(await attempt({ method: "CREDIT", cardId: cartaoDaAna.id })).toEqual({
      ok: false,
      error: "CARD_NOT_FOUND",
    });
    expect(
      await attempt({
        method: "PIX",
        accountId: contaDaBia.id,
        categoryId: ana.expenseCategory.id,
      }),
    ).toEqual({ ok: false, error: "CATEGORY_NOT_FOUND" });

    const daBia = await create(bia, { method: "PIX", accountId: contaDaBia.id });
    expect(
      await updateTransaction(
        bia.spaceId,
        daBia.id,
        entry({ method: "PIX", accountId: contaDaAna.id }),
      ),
    ).toEqual({ ok: false, error: "ACCOUNT_NOT_FOUND" });
    expect(await db.transaction.count()).toBe(1);
  });

  it("CA5: a compra no crédito grava a fatura do ciclo; a escolha manual vale dentro da janela", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const roxo = await card(ana.spaceId, azul.id);

    const computed = await create(ana, { method: "CREDIT", cardId: roxo.id, date: "2026-10-04" });
    expect(computed).toMatchObject({
      accountId: null,
      cardId: roxo.id,
      invoiceDueDate: "2026-10-12",
      invoiceOverridden: false,
    });

    const chosen = await create(ana, {
      method: "CREDIT",
      cardId: roxo.id,
      date: "2026-10-04",
      invoiceDueDate: "2026-11-12",
    });
    expect(chosen).toMatchObject({ invoiceDueDate: "2026-11-12", invoiceOverridden: true });

    expect(
      await createTransaction(
        ana.spaceId,
        ana.userId,
        randomUUID(),
        entry({
          method: "CREDIT",
          cardId: roxo.id,
          date: "2026-10-04",
          invoiceDueDate: "2027-03-12",
        }),
      ),
    ).toEqual({ ok: false, error: "INVALID_INVOICE" });
  });

  it("CA5: mudar o ciclo recalcula as compras afetadas, não as trocadas à mão nem as anteriores", async () => {
    today("2026-10-09");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const roxo = await card(ana.spaceId, azul.id); // closes 5, due 12
    const before = await create(ana, { method: "CREDIT", cardId: roxo.id, date: "2026-10-08" });

    today("2026-10-10");
    const todays = await create(ana, { method: "CREDIT", cardId: roxo.id, date: "2026-10-10" });
    const manual = await create(ana, {
      method: "CREDIT",
      cardId: roxo.id,
      date: "2026-10-10",
      invoiceDueDate: "2026-12-12",
    });
    expect(todays.invoiceDueDate).toBe("2026-11-12");

    const result = await updateCard(
      ana.spaceId,
      roxo.id,
      cardSchema.parse({ name: "Cartão Roxo", accountId: azul.id, closingDay: 20, dueDay: 27 }),
    );
    expect(result.ok).toBe(true);

    const invoiceOf = async (id: string) =>
      (await db.transaction.findUniqueOrThrow({ where: { id } })).invoiceDueDate
        ?.toISOString()
        .slice(0, 10);
    expect(await invoiceOf(before.id)).toBe("2026-11-12"); // before the change: old cycle
    expect(await invoiceOf(todays.id)).toBe("2026-10-27"); // closes 20/10 now
    expect(await invoiceOf(manual.id)).toBe("2026-12-12"); // chosen by hand
  });

  it("CA5: a correção no dia do cadastro recalcula as compras antigas já registradas", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const roxo = await card(ana.spaceId, azul.id); // typo: closes 5, due 12
    const old = await create(ana, { method: "CREDIT", cardId: roxo.id, date: "2026-10-20" });
    expect(old.invoiceDueDate).toBe("2026-11-12");

    await updateCard(
      ana.spaceId,
      roxo.id,
      cardSchema.parse({ name: "Cartão Roxo", accountId: azul.id, closingDay: 25, dueDay: 5 }),
    );
    const row = await db.transaction.findUniqueOrThrow({ where: { id: old.id } });
    expect(row.invoiceDueDate?.toISOString().slice(0, 10)).toBe("2026-11-05");
  });

  it("CA6: recusa categoria de outro tipo, categoria/conta arquivada, receita no crédito e data futura", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const roxo = await card(ana.spaceId, azul.id);
    const antiga = await account(ana.spaceId, "Antiga");
    await setAccountArchived(ana.spaceId, antiga.id, true);
    const extinta = await db.category.findFirstOrThrow({
      where: {
        spaceId: ana.spaceId,
        type: "EXPENSE",
        parentId: null,
        NOT: { id: ana.expenseCategory.id },
      },
    });
    await setCategoryArchived(ana.spaceId, extinta.id, true);
    const attempt = (fields: Record<string, unknown>) =>
      createTransaction(ana.spaceId, ana.userId, randomUUID(), entry(fields));

    expect(
      await attempt({ method: "PIX", accountId: azul.id, categoryId: ana.incomeCategory.id }),
    ).toEqual({ ok: false, error: "CATEGORY_TYPE_MISMATCH" });
    expect(await attempt({ method: "PIX", accountId: azul.id, categoryId: extinta.id })).toEqual({
      ok: false,
      error: "CATEGORY_ARCHIVED",
    });
    expect(await attempt({ method: "PIX", accountId: antiga.id })).toEqual({
      ok: false,
      error: "ACCOUNT_ARCHIVED",
    });
    expect(await attempt({ type: "INCOME", method: "CREDIT", cardId: roxo.id })).toEqual({
      ok: false,
      error: "METHOD_NOT_ALLOWED",
    });
    expect(await attempt({ method: "PIX", accountId: azul.id, date: "2026-11-01" })).toEqual({
      ok: false,
      error: "FUTURE_DATE",
    });
    expect(await db.transaction.count()).toBe(0);
  });

  it("edita: crédito vira Pix, despesa vira receita; mantém conta e cartão arquivados depois", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const roxo = await card(ana.spaceId, azul.id);
    const purchase = await create(ana, {
      method: "CREDIT",
      cardId: roxo.id,
      invoiceDueDate: "2026-12-12",
    });

    const pix = await updateTransaction(
      ana.spaceId,
      purchase.id,
      entry({ method: "PIX", accountId: azul.id, cardId: roxo.id }),
    );
    expect(pix).toMatchObject({
      ok: true,
      transaction: { method: "PIX", accountId: azul.id, cardId: null, invoiceDueDate: null },
    });

    const income = await updateTransaction(
      ana.spaceId,
      purchase.id,
      entry({
        type: "INCOME",
        method: "PIX",
        accountId: azul.id,
        categoryId: ana.incomeCategory.id,
      }),
    );
    expect(income).toMatchObject({ ok: true, transaction: { type: "INCOME" } });
    expect((await accountBalances(ana.spaceId)).get(azul.id)).toBe(100_000 + 1_000);

    // Archived after being chosen: the entry may keep it.
    await setAccountArchived(ana.spaceId, azul.id, true);
    expect(
      await updateTransaction(
        ana.spaceId,
        purchase.id,
        entry({
          type: "INCOME",
          method: "PIX",
          accountId: azul.id,
          amountCents: 2_000,
          categoryId: ana.incomeCategory.id,
        }),
      ),
    ).toMatchObject({ ok: true, transaction: { amountCents: 2_000 } });

    const onCard = await create(ana, { method: "CREDIT", cardId: roxo.id });
    await setCardArchived(ana.spaceId, roxo.id, true);
    expect(
      await updateTransaction(
        ana.spaceId,
        onCard.id,
        entry({ method: "CREDIT", cardId: roxo.id, date: "2026-10-04" }),
      ),
    ).toMatchObject({ ok: true, transaction: { invoiceDueDate: "2026-10-12" } });
  });

  it("editar a data de uma compra recalcula a fatura, a menos que a escolha manual venha de novo", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const roxo = await card(ana.spaceId, azul.id);
    const purchase = await create(ana, {
      method: "CREDIT",
      cardId: roxo.id,
      date: "2026-10-04",
      invoiceDueDate: "2026-11-12",
    });

    expect(
      await updateTransaction(
        ana.spaceId,
        purchase.id,
        entry({ method: "CREDIT", cardId: roxo.id, date: "2026-10-05" }),
      ),
    ).toMatchObject({
      ok: true,
      transaction: { invoiceDueDate: "2026-11-12", invoiceOverridden: false },
    });

    expect(
      await updateTransaction(
        ana.spaceId,
        purchase.id,
        entry({
          method: "CREDIT",
          cardId: roxo.id,
          date: "2026-10-06",
          invoiceDueDate: "2026-12-12",
        }),
      ),
    ).toMatchObject({
      ok: true,
      transaction: { invoiceDueDate: "2026-12-12", invoiceOverridden: true },
    });
  });

  it("exclui; excluir de novo é 'não encontrado'; transferência não se edita por aqui", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const verde = await account(ana.spaceId, "Banco Verde");
    const gasto = await create(ana, { method: "PIX", accountId: azul.id });

    expect(await deleteTransaction(ana.spaceId, gasto.id)).toEqual({ ok: true });
    expect(await deleteTransaction(ana.spaceId, gasto.id)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect((await accountBalances(ana.spaceId)).get(azul.id)).toBe(100_000);

    const transfer = await db.transaction.create({
      data: {
        spaceId: ana.spaceId,
        clientId: randomUUID(),
        createdById: ana.userId,
        type: "TRANSFER",
        method: "PIX",
        amountCents: 5_000,
        date: calendarDateToDb("2026-10-20"),
        accountId: azul.id,
        toAccountId: verde.id,
      },
    });
    const balances = await accountBalances(ana.spaceId);
    expect(balances.get(azul.id)).toBe(95_000);
    expect(balances.get(verde.id)).toBe(105_000);
    expect(
      await updateTransaction(
        ana.spaceId,
        transfer.id,
        entry({ method: "PIX", accountId: azul.id }),
      ),
    ).toEqual({ ok: false, error: "NOT_EDITABLE" });
  });

  it("o banco recusa formas inválidas; apagar o usuário apaga lançamentos e estabelecimentos", async () => {
    today("2026-10-31");
    const ana = await user("ana@example.com");
    const azul = await account(ana.spaceId);
    const roxo = await card(ana.spaceId, azul.id);
    await create(ana, { method: "PIX", accountId: azul.id, counterparty: "Mercado Central" });

    const base = {
      spaceId: ana.spaceId,
      createdById: ana.userId,
      type: "EXPENSE" as const,
      amountCents: 100,
      date: calendarDateToDb("2026-10-20"),
    };
    // A credit purchase that also names the account.
    await expect(
      db.transaction.create({
        data: {
          ...base,
          clientId: randomUUID(),
          method: "CREDIT",
          cardId: roxo.id,
          accountId: azul.id,
          invoiceDueDate: calendarDateToDb("2026-11-12"),
        },
      }),
    ).rejects.toThrow();
    // A zero amount.
    await expect(
      db.transaction.create({
        data: {
          ...base,
          clientId: randomUUID(),
          method: "PIX",
          accountId: azul.id,
          amountCents: 0,
        },
      }),
    ).rejects.toThrow();
    // An income on credit.
    await expect(
      db.transaction.create({
        data: {
          ...base,
          clientId: randomUUID(),
          type: "INCOME",
          method: "CREDIT",
          cardId: roxo.id,
          invoiceDueDate: calendarDateToDb("2026-11-12"),
        },
      }),
    ).rejects.toThrow();

    await db.user.delete({ where: { id: ana.userId } });
    expect(await db.transaction.count()).toBe(0);
    expect(await db.counterparty.count()).toBe(0);
  });
});
