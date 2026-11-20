import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { cardPaymentSchema, entrySchema, transferSchema } from "@/lib/validation/transactions";
import { createAccount } from "@/server/accounts";
import { createCard } from "@/server/cards";
import { dashboardMetrics } from "@/server/metrics";
import { createSubscriptionRule, setOpeningBalance } from "@/server/onboarding";
import { setRecurringRuleStatus } from "@/server/recurring";
import { ensurePersonalSpace } from "@/server/spaces";
import { createCardPayment, createTransaction, createTransfer } from "@/server/transactions";
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

async function space(email: string) {
  on();
  const user = await db.user.create({ data: { name: "Ana Teste", email } });
  const { id: spaceId } = await ensurePersonalSpace(user.id);
  // The app in use since 20/07: the earliest initial balance (before the space's creation).
  const account = await createAccount(
    spaceId,
    accountSchema.parse({
      name: "Banco Azul",
      color: "blue",
      initialBalance: "1.000,00",
      initialBalanceDate: "2026-07-20",
    }),
  );
  if (!account.ok) throw new Error(account.error);
  const other = await createAccount(
    spaceId,
    accountSchema.parse({
      name: "Banco Verde",
      color: "green",
      initialBalance: "0,00",
      initialBalanceDate: "2026-11-01",
    }),
  );
  if (!other.ok) throw new Error(other.error);
  const card = await createCard(
    spaceId,
    cardSchema.parse({
      name: "Cartão Roxo",
      accountId: account.account.id,
      closingDay: 3,
      dueDay: 10,
    }),
  );
  if (!card.ok) throw new Error(card.error);
  const category = async (name: string) =>
    (await db.category.findFirstOrThrow({ where: { spaceId, name } })).id;
  return {
    userId: user.id,
    spaceId,
    accountId: account.account.id,
    otherAccountId: other.account.id,
    cardId: card.card.id,
    aluguel: await category("Aluguel"),
    mercado: await category("Mercado"),
    restaurante: await category("Restaurante"),
    lazer: await category("Lazer"),
    salario: await category("Salário"),
    reembolsos: await category("Reembolsos"),
  };
}

type Space = Awaited<ReturnType<typeof space>>;

async function entry(s: Space, input: Record<string, unknown>) {
  const credit = input.method === "CREDIT";
  const result = await createTransaction(
    s.spaceId,
    s.userId,
    randomUUID(),
    entrySchema.parse({
      type: "EXPENSE",
      method: "PIX",
      ...(credit ? { cardId: s.cardId } : { accountId: s.accountId }),
      ...input,
    }),
  );
  if (!result.ok) throw new Error(result.error);
}

/** The fixed data set of src/domain/metrics.test.ts, through the app's own writes. */
async function fixedDataSet(s: Space) {
  for (const m of ["08", "09", "10"]) {
    await entry(s, {
      type: "INCOME",
      amountCents: 800_000,
      date: `2026-${m}-05`,
      categoryId: s.salario,
    });
    await entry(s, { amountCents: 250_000, date: `2026-${m}-05`, categoryId: s.aluguel });
  }
  await entry(s, { amountCents: 24_000, date: "2026-08-12", categoryId: s.mercado });
  await entry(s, { amountCents: 36_000, date: "2026-09-12", categoryId: s.mercado });
  await entry(s, { amountCents: 6_000, date: "2026-09-20", categoryId: s.restaurante });
  await entry(s, { amountCents: 30_000, date: "2026-10-12", categoryId: s.mercado });
  // CA2: on credit on 28/10 (after the closing on the 3rd: its invoice is due on 10/12).
  await entry(s, {
    amountCents: 20_000,
    date: "2026-10-28",
    method: "CREDIT",
    categoryId: s.restaurante,
  });
  await entry(s, {
    amountCents: 100_000,
    date: "2026-10-28",
    method: "CREDIT",
    categoryId: s.lazer,
    installments: 10,
  });
  await entry(s, {
    type: "INCOME",
    amountCents: 800_000,
    date: "2026-11-05",
    categoryId: s.salario,
  });
  await entry(s, { amountCents: 250_000, date: "2026-11-05", categoryId: s.aluguel });
  await entry(s, { amountCents: 30_000, date: "2026-11-03", categoryId: s.mercado });
  await entry(s, { amountCents: 12_000, date: "2026-11-10", categoryId: s.restaurante });
  await entry(s, { amountCents: 4_000, date: "2026-11-14" });
  // A subscription started on 08/11: its 1st charge now, the rule's cursor in December.
  await entry(s, {
    amountCents: 3_990,
    date: "2026-11-08",
    categoryId: s.lazer,
    subscription: true,
  });
  await entry(s, {
    type: "INCOME",
    amountCents: 5_000,
    date: "2026-11-12",
    method: "CREDIT",
    categoryId: s.reembolsos,
  });
  // A subscription charging on the 20th, and a paused one.
  const rule = (amountCents: number, dayOfMonth: number, counterparty: string) =>
    createSubscriptionRule(s.spaceId, s.userId, {
      counterparty,
      amountCents,
      dayOfMonth,
      method: "PIX",
      accountId: s.accountId,
      cardId: null,
      categoryId: null,
      description: null,
    });
  await rule(9_900, 20, "Academia");
  const paused = await rule(2_500, 25, "Jornal");
  if (!paused.ok) throw new Error(paused.error);
  await setRecurringRuleStatus(s.spaceId, paused.id, "PAUSED");

  // CA5: none of these counts.
  await createTransfer(
    s.spaceId,
    s.userId,
    randomUUID(),
    transferSchema.parse({
      amountCents: 100_000,
      date: "2026-11-06",
      method: "PIX",
      accountId: s.accountId,
      toAccountId: s.otherAccountId,
    }),
  );
  await createCardPayment(
    s.spaceId,
    s.userId,
    randomUUID(),
    cardPaymentSchema.parse({
      amountCents: 50_000,
      date: "2026-11-10",
      method: "PIX",
      accountId: s.accountId,
      cardId: s.cardId,
      invoiceDueDate: "2026-11-10",
    }),
  );
  await db.transaction.create({
    data: {
      spaceId: s.spaceId,
      clientId: randomUUID(),
      createdById: s.userId,
      type: "EXPENSE",
      amountCents: 7_000,
      date: new Date("2026-11-11T00:00:00Z"),
      method: "PIX",
      accountId: s.accountId,
      adjustment: true,
    },
  });
  await setOpeningBalance(s.spaceId, s.userId, s.cardId, "2026-12-10", 200_000);
}

describe("dashboardMetrics", () => {
  it("CA7: dá os números do conjunto fixo, só do espaço", async () => {
    const s = await space("ana@example.com");
    await fixedDataSet(s);
    // Another space's November expense never shows.
    const other = await space("bia@example.com");
    await entry(other, { amountCents: 99_900, date: "2026-11-03", categoryId: other.mercado });

    // The noise is really there (CA5): a transfer, a payment and two adjustments.
    const noise = await db.transaction.groupBy({
      by: ["type", "adjustment"],
      where: {
        spaceId: s.spaceId,
        OR: [{ adjustment: true }, { type: { in: ["TRANSFER", "CARD_PAYMENT"] } }],
      },
      _count: true,
    });
    expect(noise.reduce((n, g) => n + g._count, 0)).toBe(4);

    on();
    const metrics = await dashboardMetrics(s.spaceId, "2026-11");
    expect(metrics).not.toBeNull();
    const m = metrics!;
    expect(m.historyStart).toBe("2026-07-20");
    expect(m.summary).toEqual({
      month: "2026-11",
      incomeCents: 805_000,
      expenseCents: 309_990,
      leftoverCents: 495_010,
      savingsRate: 495_010 / 805_000,
      fixedCents: 263_990,
      variableCents: 46_000,
    });
    expect(m.projection).toEqual({
      expenseToDateCents: 299_990,
      variableToDateCents: 46_000,
      dailyPaceCents: 3_067,
      remainingDays: 15,
      upcomingFixedCents: 19_900,
      projectedExpenseCents: 365_890,
      projectedLeftoverCents: 439_110,
    });
    // Without the subscription starting in February of the unit data set: 100 + 138,90 a month.
    expect(m.commitments.months.map((c) => c.totalCents)).toEqual(Array(6).fill(23_890));
    expect(m.commitments.totalCents).toBe(143_340);
    expect(m.commitments.remainingInstallmentsCents).toBe(80_000);
    expect(m.categories.map((c) => [c.name, c.totalCents, c.averageCents])).toEqual([
      ["Moradia", 250_000, 250_000],
      ["Alimentação", 42_000, 38_667],
      ["Lazer", 13_990, 3_333],
      ["Sem categoria", 4_000, 0],
    ]);
    expect(m.evolution.map((e) => [e.month, e.beforeHistory, e.expenseCents])).toEqual([
      ["2026-06", true, 0],
      ["2026-07", false, 0],
      ["2026-08", false, 274_000],
      ["2026-09", false, 292_000],
      ["2026-10", false, 310_000],
      ["2026-11", false, 309_990],
    ]);

    // A past month: no projection, the same commitments (they start after today's month).
    const october = (await dashboardMetrics(s.spaceId, "2026-10"))!;
    expect(october.projection).toBeNull();
    expect(october.summary.expenseCents).toBe(310_000);
    expect(october.commitments.totalCents).toBe(143_340);
  });

  it("as cobranças vencidas são geradas antes de calcular", async () => {
    const s = await space("ana@example.com");
    await entry(s, { amountCents: 3_990, date: "2026-10-08", subscription: true });
    on();
    // November's charge (08/11) is generated by the metrics call itself.
    const m = (await dashboardMetrics(s.spaceId, "2026-11"))!;
    expect(m.summary.expenseCents).toBe(3_990);
    expect(m.summary.fixedCents).toBe(3_990);
  });

  it("o início do histórico é a criação do espaço quando o saldo inicial é depois", async () => {
    const s = await space("ana@example.com");
    await db.account.updateMany({
      where: { spaceId: s.spaceId },
      data: { initialBalanceDate: new Date("2026-11-01T00:00:00Z") },
    });
    await db.space.update({
      where: { id: s.spaceId },
      data: { createdAt: new Date("2026-10-30T15:00:00Z") },
    });
    expect((await dashboardMetrics(s.spaceId, "2026-11"))!.historyStart).toBe("2026-10-30");
  });

  it("um mês mal formado é recusado", async () => {
    const s = await space("ana@example.com");
    expect(await dashboardMetrics(s.spaceId, "2026-13")).toBeNull();
    expect(await dashboardMetrics(s.spaceId, "novembro")).toBeNull();
  });
});
