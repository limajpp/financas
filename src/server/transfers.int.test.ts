import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { cardPaymentSchema, entrySchema, transferSchema } from "@/lib/validation/transactions";
import { createAccount, setAccountArchived } from "@/server/accounts";
import { createCard, setCardArchived } from "@/server/cards";
import { registerData } from "@/server/register";
import { ensurePersonalSpace } from "@/server/spaces";
import {
  accountBalances,
  cardInvoices,
  cardsInvoices,
  createCardPayment,
  createTransaction,
  createTransfer,
} from "@/server/transactions";
import { resetDatabase } from "@/test/db";

beforeEach(resetDatabase);
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

let minute = 0;
/** "Now" on 2026-11-08 in São Paulo; each call moves a minute ahead. */
function tick() {
  vi.useFakeTimers({ toFake: ["Date"] });
  minute += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 8, 15, minute)));
}

async function owner(email: string) {
  tick();
  const user = await db.user.create({ data: { name: "Ana Teste", email } });
  const space = await ensurePersonalSpace(user.id);
  const account = async (name: string, balance = "1.000,00") => {
    const result = await createAccount(
      space.id,
      accountSchema.parse({
        name,
        color: "blue",
        initialBalance: balance,
        initialBalanceDate: "2026-10-01",
      }),
    );
    if (!result.ok) throw new Error(result.error);
    return result.account;
  };
  return { userId: user.id, spaceId: space.id, account };
}

type Owner = Awaited<ReturnType<typeof owner>>;

/** Closes on the 3rd, due on the 10th. Today (11-08) the open invoice is due 2026-12-10. */
async function card(who: Owner, accountId: string) {
  const result = await createCard(
    who.spaceId,
    cardSchema.parse({ name: "Cartão Roxo", accountId, closingDay: 3, dueDay: 10 }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.card;
}

const transfer = (who: Owner, fields: Record<string, unknown>, clientId = randomUUID()) => {
  tick();
  return createTransfer(
    who.spaceId,
    who.userId,
    clientId,
    transferSchema.parse({ amountCents: 50_000, date: "2026-11-05", method: "PIX", ...fields }),
  );
};

const pay = (who: Owner, fields: Record<string, unknown>, clientId = randomUUID()) => {
  tick();
  return createCardPayment(
    who.spaceId,
    who.userId,
    clientId,
    cardPaymentSchema.parse({ date: "2026-11-07", method: "BOLETO", ...fields }),
  );
};

async function purchase(who: Owner, cardId: string, date: string, amountCents: number) {
  tick();
  const result = await createTransaction(
    who.spaceId,
    who.userId,
    randomUUID(),
    entrySchema.parse({ type: "EXPENSE", amountCents, date, method: "CREDIT", cardId }),
  );
  if (!result.ok) throw new Error(result.error);
}

describe("transferência", () => {
  it("CA1: tira da origem e põe no destino", async () => {
    const ana = await owner("ana@example.com");
    const azul = await ana.account("Banco Azul");
    const verde = await ana.account("Banco Verde", "0");

    const result = await transfer(ana, { accountId: azul.id, toAccountId: verde.id });
    expect(result).toMatchObject({
      ok: true,
      created: true,
      transaction: {
        type: "TRANSFER",
        accountId: azul.id,
        toAccountId: verde.id,
        categoryId: null,
      },
    });
    const balances = await accountBalances(ana.spaceId);
    expect(balances.get(azul.id)).toBe(50_000);
    expect(balances.get(verde.id)).toBe(50_000);
  });

  it("CA3: origem e destino iguais são recusados; o banco também recusa", async () => {
    const ana = await owner("ana@example.com");
    const azul = await ana.account("Banco Azul");
    expect(
      transferSchema.safeParse({
        amountCents: 1,
        date: "2026-11-05",
        method: "PIX",
        accountId: azul.id,
        toAccountId: azul.id,
      }).success,
    ).toBe(false);
    // Past the schema (as the sync could), the rule and the CHECK still refuse it.
    expect(
      await createTransfer(ana.spaceId, ana.userId, randomUUID(), {
        amountCents: 1,
        date: "2026-11-05",
        method: "PIX",
        accountId: azul.id,
        toAccountId: azul.id,
        description: null,
      }),
    ).toEqual({ ok: false, error: "SAME_ACCOUNT" });
    expect(await db.transaction.count()).toBe(0);
  });

  it("recusa conta arquivada e de outro espaço; o mesmo clientId não duplica", async () => {
    const ana = await owner("ana@example.com");
    const bia = await owner("bia@example.com");
    const azul = await ana.account("Banco Azul");
    const verde = await ana.account("Banco Verde");
    const contaDaBia = await bia.account("Banco da Bia");

    expect(await transfer(ana, { accountId: azul.id, toAccountId: contaDaBia.id })).toEqual({
      ok: false,
      error: "TO_ACCOUNT_NOT_FOUND",
    });
    await setAccountArchived(ana.spaceId, verde.id, true);
    expect(await transfer(ana, { accountId: azul.id, toAccountId: verde.id })).toEqual({
      ok: false,
      error: "TO_ACCOUNT_ARCHIVED",
    });
    await setAccountArchived(ana.spaceId, verde.id, false);

    const clientId = randomUUID();
    await transfer(ana, { accountId: azul.id, toAccountId: verde.id }, clientId);
    const again = await transfer(ana, { accountId: azul.id, toAccountId: verde.id }, clientId);
    expect(again).toMatchObject({ ok: true, created: false });
    expect(await db.transaction.count()).toBe(1);
  });

  it("o registro lembra a última origem, destino e forma", async () => {
    const ana = await owner("ana@example.com");
    const azul = await ana.account("Banco Azul");
    const verde = await ana.account("Banco Verde");
    expect((await registerData(ana.spaceId)).transfer).toEqual({
      accountId: azul.id,
      toAccountId: verde.id,
      method: "PIX",
    });
    await transfer(ana, { accountId: verde.id, toAccountId: azul.id, method: "TED" });
    // An expense after it doesn't change what the transfer remembers.
    tick();
    await createTransaction(
      ana.spaceId,
      ana.userId,
      randomUUID(),
      entrySchema.parse({
        type: "EXPENSE",
        amountCents: 100,
        date: "2026-11-05",
        method: "DEBIT",
        accountId: azul.id,
      }),
    );
    expect((await registerData(ana.spaceId)).transfer).toEqual({
      accountId: verde.id,
      toAccountId: azul.id,
      method: "TED",
    });
  });
});

describe("pagamento de fatura", () => {
  it("CA1 e CA4: reduz a conta que paga; o resumo mostra total, pago e em aberto", async () => {
    const ana = await owner("ana@example.com");
    const azul = await ana.account("Banco Azul");
    const roxo = await card(ana, azul.id);
    await purchase(ana, roxo.id, "2026-10-20", 30_000); // closes 11-03, due 11-10
    await purchase(ana, roxo.id, "2026-11-01", 20_000);
    await purchase(ana, roxo.id, "2026-11-05", 7_000); // open invoice, due 12-10

    expect((await accountBalances(ana.spaceId)).get(azul.id)).toBe(100_000);
    expect(await cardInvoices(ana.spaceId, roxo.id)).toEqual({
      invoices: [
        {
          dueDate: "2026-11-10",
          closingDate: "2026-11-03",
          totalCents: 50_000,
          paidCents: 0,
          remainingCents: 50_000,
          status: "closed",
        },
        {
          dueDate: "2026-12-10",
          closingDate: "2026-12-03",
          totalCents: 7_000,
          paidCents: 0,
          remainingCents: 7_000,
          status: "open",
        },
      ],
      defaultDueDate: "2026-11-10",
      accountId: azul.id,
      method: "PIX",
    });

    const paid = await pay(ana, {
      amountCents: 20_000,
      accountId: azul.id,
      cardId: roxo.id,
      invoiceDueDate: "2026-11-10",
    });
    expect(paid).toMatchObject({
      ok: true,
      transaction: { type: "CARD_PAYMENT", cardId: roxo.id, invoiceDueDate: "2026-11-10" },
    });
    expect((await accountBalances(ana.spaceId)).get(azul.id)).toBe(80_000);
    expect(await cardInvoices(ana.spaceId, roxo.id)).toMatchObject({
      invoices: [{ paidCents: 20_000, remainingCents: 30_000 }, { remainingCents: 7_000 }],
      defaultDueDate: "2026-11-10",
      method: "BOLETO",
    });
  });

  it("CA5: recusa fatura que não é do cartão; aceita cartão arquivado", async () => {
    const ana = await owner("ana@example.com");
    const azul = await ana.account("Banco Azul");
    const roxo = await card(ana, azul.id);
    const base = { amountCents: 1_000, accountId: azul.id, cardId: roxo.id };

    expect(await pay(ana, { ...base, invoiceDueDate: "2026-11-11" })).toEqual({
      ok: false,
      error: "INVALID_INVOICE",
    });
    expect(await pay(ana, { ...base, invoiceDueDate: "2027-02-10" })).toEqual({
      ok: false,
      error: "INVALID_INVOICE",
    });

    await setCardArchived(ana.spaceId, roxo.id, true);
    expect(await pay(ana, { ...base, invoiceDueDate: "2026-11-10" })).toMatchObject({ ok: true });
  });

  it("CA5: cartão ou conta de outro espaço é 'não encontrado'; o mesmo clientId não duplica", async () => {
    const ana = await owner("ana@example.com");
    const bia = await owner("bia@example.com");
    const azul = await ana.account("Banco Azul");
    const contaDaBia = await bia.account("Banco da Bia");
    const cartaoDaBia = await card(bia, contaDaBia.id);
    const roxo = await card(ana, azul.id);

    expect(
      await pay(ana, {
        amountCents: 1_000,
        accountId: azul.id,
        cardId: cartaoDaBia.id,
        invoiceDueDate: "2026-11-10",
      }),
    ).toEqual({ ok: false, error: "CARD_NOT_FOUND" });
    expect(
      await pay(ana, {
        amountCents: 1_000,
        accountId: contaDaBia.id,
        cardId: roxo.id,
        invoiceDueDate: "2026-11-10",
      }),
    ).toEqual({ ok: false, error: "ACCOUNT_NOT_FOUND" });
    expect(await cardInvoices(ana.spaceId, cartaoDaBia.id)).toBeNull();

    const clientId = randomUUID();
    const fields = {
      amountCents: 1_000,
      accountId: azul.id,
      cardId: roxo.id,
      invoiceDueDate: "2026-11-10",
    };
    await pay(ana, fields, clientId);
    expect(await pay(ana, fields, clientId)).toMatchObject({ ok: true, created: false });
    expect(await db.transaction.count({ where: { type: "CARD_PAYMENT" } })).toBe(1);
  });

  it("CA5: uma fatura antiga (mais de 12 atrás) é pagável se tem compras", async () => {
    const ana = await owner("ana@example.com");
    const azul = await ana.account("Banco Azul");
    const roxo = await card(ana, azul.id);
    await purchase(ana, roxo.id, "2025-01-20", 9_000); // due 2025-02-10
    expect(
      await pay(ana, {
        amountCents: 9_000,
        accountId: azul.id,
        cardId: roxo.id,
        invoiceDueDate: "2025-02-10",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await pay(ana, {
        amountCents: 1,
        accountId: azul.id,
        cardId: roxo.id,
        invoiceDueDate: "2025-03-10",
      }),
    ).toEqual({ ok: false, error: "INVALID_INVOICE" });
  });

  it("os resumos de vários cartões saem juntos, cada um com o seu", async () => {
    const ana = await owner("ana@example.com");
    const azul = await ana.account("Banco Azul");
    const verde = await ana.account("Banco Verde");
    const roxo = await card(ana, azul.id);
    const preto = await createCard(
      ana.spaceId,
      cardSchema.parse({ name: "Cartão Preto", accountId: verde.id, closingDay: 25, dueDay: 5 }),
    );
    if (!preto.ok) throw new Error(preto.error);
    await purchase(ana, roxo.id, "2026-11-05", 1_000);
    await purchase(ana, preto.card.id, "2026-11-05", 2_000);

    const all = await cardsInvoices(ana.spaceId, [
      { id: roxo.id, accountId: azul.id, cycles: roxo.cycles },
      { id: preto.card.id, accountId: verde.id, cycles: preto.card.cycles },
    ]);
    expect(all.get(roxo.id)?.invoices).toMatchObject([
      { dueDate: "2026-12-10", totalCents: 1_000 },
    ]);
    expect(all.get(preto.card.id)).toMatchObject({
      accountId: verde.id,
      invoices: [{ dueDate: "2026-12-05", totalCents: 2_000, status: "open" }],
    });
  });

  it("uma mudança de ciclo não move a fatura de um pagamento", async () => {
    const ana = await owner("ana@example.com");
    const azul = await ana.account("Banco Azul");
    const roxo = await card(ana, azul.id);
    await pay(ana, {
      amountCents: 1_000,
      accountId: azul.id,
      cardId: roxo.id,
      invoiceDueDate: "2026-12-10",
    });
    const { updateCard } = await import("@/server/cards");
    await updateCard(
      ana.spaceId,
      roxo.id,
      cardSchema.parse({ name: "Cartão Roxo", accountId: azul.id, closingDay: 20, dueDay: 27 }),
    );
    const row = await db.transaction.findFirstOrThrow({ where: { type: "CARD_PAYMENT" } });
    expect(row.invoiceDueDate?.toISOString().slice(0, 10)).toBe("2026-12-10");
  });
});
