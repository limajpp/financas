import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { entrySchema } from "@/lib/validation/transactions";
import { createAccount } from "@/server/accounts";
import { createCard } from "@/server/cards";
import {
  generateRecurring,
  setRecurringRuleStatus,
  undoSubscription,
  updateRecurringRule,
} from "@/server/recurring";
import { categoryUsage, registerData } from "@/server/register";
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

let minute = 0;
/** "Now" on `day` in São Paulo; each call moves a minute ahead. */
function on(day: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  minute += 1;
  vi.setSystemTime(new Date(`${day}T15:${String(minute % 60).padStart(2, "0")}:00Z`));
}

async function setup(email = "ana@example.com") {
  on("2026-09-01");
  const user = await db.user.create({ data: { name: "Ana Teste", email } });
  const space = await ensurePersonalSpace(user.id);
  const account = await createAccount(
    space.id,
    accountSchema.parse({
      name: "Banco Azul",
      color: "blue",
      initialBalance: "1.000,00",
      initialBalanceDate: "2026-08-31",
    }),
  );
  if (!account.ok) throw new Error(account.error);
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
  const lazer = await db.category.findFirstOrThrow({ where: { spaceId: space.id, name: "Lazer" } });
  return {
    userId: user.id,
    spaceId: space.id,
    accountId: account.account.id,
    cardId: card.card.id,
    lazer,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** A R$ 39,90 subscription by Pix starting on `date`. */
async function subscribe(
  s: Setup,
  date: string,
  fields: Record<string, unknown> = {},
  clientId = randomUUID(),
  today = date,
) {
  on(today);
  const result = await createTransaction(
    s.spaceId,
    s.userId,
    clientId,
    entrySchema.parse({
      type: "EXPENSE",
      amountCents: 3_990,
      date,
      method: "PIX",
      accountId: s.accountId,
      categoryId: s.lazer.id,
      counterparty: "Streaming",
      subscription: true,
      ...fields,
    }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.transaction;
}

const charges = (ruleId: string) =>
  db.transaction.findMany({
    where: { recurringRuleId: ruleId },
    orderBy: { date: "asc" },
    select: { recurringMonth: true, date: true, amountCents: true, invoiceDueDate: true },
  });

const day = (d: Date | null) => d?.toISOString().slice(0, 10);

describe("assinaturas", () => {
  it("CA5: cria a regra e a 1ª cobrança juntas; o mesmo clientId não duplica nenhuma", async () => {
    const s = await setup();
    const clientId = randomUUID();
    const first = await subscribe(s, "2026-09-08", {}, clientId);
    expect(first).toMatchObject({ amountCents: 3_990, recurringMonth: "2026-09" });
    const rule = await db.recurringRule.findUniqueOrThrow({
      where: { id: first.recurringRuleId! },
    });
    expect(rule).toMatchObject({
      amountCents: 3_990,
      dayOfMonth: 8,
      method: "PIX",
      status: "ACTIVE",
      firstMonth: "2026-09",
      nextMonth: "2026-10",
    });

    await subscribe(s, "2026-09-08", {}, clientId);
    expect(await db.recurringRule.count()).toBe(1);
    expect(await db.transaction.count()).toBe(1);
  });

  it("CA1 e CA5: gera os meses em atraso, cada um na sua data; rodar de novo, ou em paralelo, não duplica", async () => {
    const s = await setup();
    const first = await subscribe(s, "2026-09-08");
    on("2026-11-10");
    const runs = await Promise.all([generateRecurring(s.spaceId), generateRecurring(s.spaceId)]);
    expect(runs.reduce((sum, r) => sum + r.charged, 0)).toBe(2);
    expect(await generateRecurring(s.spaceId)).toEqual({ charged: 0 });

    expect(
      (await charges(first.recurringRuleId!)).map((c) => [c.recurringMonth, day(c.date)]),
    ).toEqual([
      ["2026-09", "2026-09-08"],
      ["2026-10", "2026-10-08"],
      ["2026-11", "2026-11-08"],
    ]);
    expect((await accountBalances(s.spaceId)).get(s.accountId)).toBe(100_000 - 3 * 3_990);
  });

  it("CA1: excluir a cobrança de um mês não a faz voltar", async () => {
    const s = await setup();
    const first = await subscribe(s, "2026-09-08");
    on("2026-10-09");
    await generateRecurring(s.spaceId);
    const october = await db.transaction.findFirstOrThrow({
      where: { recurringRuleId: first.recurringRuleId, recurringMonth: "2026-10" },
    });
    await deleteTransaction(s.spaceId, october.id);
    await generateRecurring(s.spaceId);
    expect((await charges(first.recurringRuleId!)).map((c) => c.recurringMonth)).toEqual([
      "2026-09",
    ]);
  });

  it("CA2: dia 31 cobra no último dia dos meses curtos; no crédito cai na fatura certa", async () => {
    const s = await setup();
    const first = await subscribe(s, "2026-01-31", {
      method: "CREDIT",
      accountId: undefined,
      cardId: s.cardId,
    });
    on("2026-04-30");
    await generateRecurring(s.spaceId);
    expect(
      (await charges(first.recurringRuleId!)).map((c) => [day(c.date), day(c.invoiceDueDate)]),
    ).toEqual([
      ["2026-01-31", "2026-02-10"],
      ["2026-02-28", "2026-03-10"],
      ["2026-03-31", "2026-04-10"],
      ["2026-04-30", "2026-05-10"],
    ]);
  });

  it("CA3: a mudança de valor fica registrada; as próximas usam o valor novo, as geradas não mudam", async () => {
    const s = await setup();
    const first = await subscribe(s, "2026-09-08");
    const ruleId = first.recurringRuleId!;
    on("2026-10-20");
    await generateRecurring(s.spaceId);
    expect(await updateRecurringRule(s.spaceId, ruleId, { amountCents: 4_490 })).toEqual({
      ok: true,
    });

    // "Atualizar a assinatura?" — yes, from the October charge.
    const october = await db.transaction.findFirstOrThrow({
      where: { recurringRuleId: ruleId, recurringMonth: "2026-10" },
    });
    on("2026-10-21");
    const edited = await updateTransaction(
      s.spaceId,
      october.id,
      entrySchema.parse({
        type: "EXPENSE",
        amountCents: 4_990,
        date: "2026-10-08",
        method: "PIX",
        accountId: s.accountId,
        categoryId: s.lazer.id,
        counterparty: "Streaming",
      }),
      "this",
      { updateRule: true },
    );
    expect(edited).toMatchObject({ ok: true, transaction: { amountCents: 4_990 } });

    const changes = await db.recurringRuleChange.findMany({
      where: { ruleId },
      orderBy: { createdAt: "asc" },
    });
    expect(changes.map((c) => [c.previousCents, c.amountCents, day(c.changedOn)])).toEqual([
      [3_990, 4_490, "2026-10-20"],
      [4_490, 4_990, "2026-10-21"],
    ]);

    on("2026-11-08");
    await generateRecurring(s.spaceId);
    expect((await charges(ruleId)).map((c) => c.amountCents)).toEqual([3_990, 4_990, 4_990]);
  });

  it("CA3: sem updateRule, só a cobrança muda", async () => {
    const s = await setup();
    const first = await subscribe(s, "2026-09-08");
    on("2026-09-09");
    await updateTransaction(
      s.spaceId,
      first.id,
      entrySchema.parse({
        type: "EXPENSE",
        amountCents: 5_000,
        date: "2026-09-08",
        method: "PIX",
        accountId: s.accountId,
      }),
    );
    const rule = await db.recurringRule.findUniqueOrThrow({
      where: { id: first.recurringRuleId! },
    });
    expect(rule.amountCents).toBe(3_990);
    expect(await db.recurringRuleChange.count()).toBe(0);
  });

  it("CA4: cancelada não gera mais; pausada pula os meses; retomar não cria as atrasadas", async () => {
    const s = await setup();
    const first = await subscribe(s, "2026-09-08");
    const ruleId = first.recurringRuleId!;

    on("2026-09-20");
    await setRecurringRuleStatus(s.spaceId, ruleId, "PAUSED");
    // The app isn't opened during the pause.
    on("2026-11-20");
    await setRecurringRuleStatus(s.spaceId, ruleId, "ACTIVE");
    await generateRecurring(s.spaceId);
    expect((await charges(ruleId)).map((c) => c.recurringMonth)).toEqual(["2026-09"]);

    on("2026-12-08");
    await generateRecurring(s.spaceId);
    expect((await charges(ruleId)).map((c) => c.recurringMonth)).toEqual(["2026-09", "2026-12"]);

    await setRecurringRuleStatus(s.spaceId, ruleId, "CANCELED");
    on("2027-02-10");
    await generateRecurring(s.spaceId);
    expect((await charges(ruleId)).map((c) => c.recurringMonth)).toEqual(["2026-09", "2026-12"]);
    expect(await setRecurringRuleStatus(s.spaceId, ruleId, "ACTIVE")).toEqual({
      ok: false,
      error: "CANCELED",
    });
  });

  it("CA5: outro espaço não vê, não muda nem gera", async () => {
    const ana = await setup();
    const bia = await setup("bia@example.com");
    const first = await subscribe(ana, "2026-09-08");
    const ruleId = first.recurringRuleId!;
    expect(await setRecurringRuleStatus(bia.spaceId, ruleId, "CANCELED")).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await updateRecurringRule(bia.spaceId, ruleId, { amountCents: 1 })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await undoSubscription(bia.spaceId, first.id)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    on("2026-10-09");
    await generateRecurring(bia.spaceId);
    expect(await db.transaction.count({ where: { spaceId: bia.spaceId } })).toBe(0);
  });

  it("Desfazer na 1ª cobrança desfaz a assinatura inteira, mesmo com data passada", async () => {
    const s = await setup();
    const first = await subscribe(s, "2026-09-08");
    expect(await undoSubscription(s.spaceId, first.id)).toEqual({ ok: true });
    expect(await db.recurringRule.count()).toBe(0);
    expect(await db.transaction.count()).toBe(0);

    // Backdated: registered on 11-08 with the date 10-05; the home render charges November.
    const backdated = await subscribe(s, "2026-10-05", {}, randomUUID(), "2026-11-08");
    await generateRecurring(s.spaceId);
    expect(await db.transaction.count()).toBe(2);
    expect(await undoSubscription(s.spaceId, backdated.id)).toEqual({ ok: true });
    expect(await db.recurringRule.count()).toBe(0);
    expect(await db.transaction.count()).toBe(0);
  });

  it("Desfazer numa cobrança gerada apaga só ela", async () => {
    const s = await setup();
    const first = await subscribe(s, "2026-09-08");
    on("2026-10-09");
    await generateRecurring(s.spaceId);
    const october = await db.transaction.findFirstOrThrow({
      where: { recurringRuleId: first.recurringRuleId, recurringMonth: "2026-10" },
    });
    expect(await undoSubscription(s.spaceId, october.id)).toEqual({ ok: true });
    expect(await db.recurringRule.count()).toBe(1);
    expect((await charges(first.recurringRuleId!)).map((c) => c.recurringMonth)).toEqual([
      "2026-09",
    ]);
  });

  it("uma cobrança de assinatura não vira receita", async () => {
    const s = await setup();
    const first = await subscribe(s, "2026-09-08");
    const salario = await db.category.findFirstOrThrow({
      where: { spaceId: s.spaceId, name: "Salário" },
    });
    on("2026-09-09");
    expect(
      await updateTransaction(
        s.spaceId,
        first.id,
        entrySchema.parse({
          type: "INCOME",
          amountCents: 3_990,
          date: "2026-09-08",
          method: "PIX",
          accountId: s.accountId,
          categoryId: salario.id,
        }),
      ),
    ).toEqual({ ok: false, error: "SUBSCRIPTION_LOCKED" });
  });

  it("CA4: cancelar ao mesmo tempo que retomar termina cancelada", async () => {
    const s = await setup();
    const first = await subscribe(s, "2026-09-08");
    const ruleId = first.recurringRuleId!;
    await setRecurringRuleStatus(s.spaceId, ruleId, "PAUSED");
    const results = await Promise.all([
      setRecurringRuleStatus(s.spaceId, ruleId, "CANCELED"),
      setRecurringRuleStatus(s.spaceId, ruleId, "ACTIVE"),
    ]);
    expect(results[0]).toEqual({ ok: true });
    const rule = await db.recurringRule.findUniqueOrThrow({ where: { id: ruleId } });
    expect(rule.status).toBe("CANCELED");
    expect(rule.canceledAt).not.toBeNull();
  });

  it("CA4: a geração passa o cursor de uma pausada sem cobrar", async () => {
    const s = await setup();
    const first = await subscribe(s, "2026-09-08");
    const ruleId = first.recurringRuleId!;
    await setRecurringRuleStatus(s.spaceId, ruleId, "PAUSED");
    on("2026-11-20");
    await generateRecurring(s.spaceId);
    const rule = await db.recurringRule.findUniqueOrThrow({ where: { id: ruleId } });
    expect(rule.nextMonth).toBe("2026-12");
    expect((await charges(ruleId)).map((c) => c.recurringMonth)).toEqual(["2026-09"]);
  });

  it("CA6: a observação sugerida ignora as cobranças geradas", async () => {
    const s = await setup();
    await subscribe(s, "2026-09-08", { description: "Plano básico" });
    on("2026-09-10");
    await createTransaction(
      s.spaceId,
      s.userId,
      randomUUID(),
      entrySchema.parse({
        type: "EXPENSE",
        amountCents: 5_990,
        date: "2026-09-10",
        method: "PIX",
        accountId: s.accountId,
        counterparty: "Streaming",
        description: "Plano família",
      }),
    );
    on("2026-10-09");
    await generateRecurring(s.spaceId);
    const [memory] = (await registerData(s.spaceId)).counterparties;
    expect(memory?.suggestions.EXPENSE.description).toBe("Plano família");
  });

  it("CA6: as cobranças geradas não contam nas sugestões nem lembram a forma de pagamento", async () => {
    const s = await setup();
    await subscribe(s, "2026-09-08", { method: "CREDIT", accountId: undefined, cardId: s.cardId });
    on("2026-09-10");
    await createTransaction(
      s.spaceId,
      s.userId,
      randomUUID(),
      entrySchema.parse({
        type: "EXPENSE",
        amountCents: 100,
        date: "2026-09-10",
        method: "DEBIT",
        accountId: s.accountId,
      }),
    );
    on("2026-11-10");
    await generateRecurring(s.spaceId);

    expect(await categoryUsage(s.spaceId, "EXPENSE")).toMatchObject([
      { categoryId: s.lazer.id, count: 1 },
    ]);
    const data = await registerData(s.spaceId);
    expect(data.counterparties).toMatchObject([{ name: "Streaming", useCount: 1 }]);
    // The last method you chose (debit), not the subscription's monthly credit charge.
    expect(data.EXPENSE.payment?.method).toBe("DEBIT");
  });

  it("apagar o usuário apaga as regras e o histórico", async () => {
    const s = await setup();
    const first = await subscribe(s, "2026-09-08");
    await updateRecurringRule(s.spaceId, first.recurringRuleId!, { amountCents: 4_000 });
    await db.user.delete({ where: { id: s.userId } });
    expect(await db.recurringRule.count()).toBe(0);
    expect(await db.recurringRuleChange.count()).toBe(0);
  });
});
