import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { memorySchema } from "@/lib/validation/counterparties";
import { entrySchema } from "@/lib/validation/transactions";
import { createAccount } from "@/server/accounts";
import { createCard } from "@/server/cards";
import {
  counterpartyDetail,
  counterpartyRanking,
  mergeCounterparties,
  mergePreview,
  updateCounterparty,
} from "@/server/counterparties";
import { generateRecurring } from "@/server/recurring";
import { registerData } from "@/server/register";
import { ensurePersonalSpace } from "@/server/spaces";
import { createTransaction } from "@/server/transactions";
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
  on("2026-11-15");
  const user = await db.user.create({ data: { name: "Ana Teste", email } });
  const space = await ensurePersonalSpace(user.id);
  const account = await createAccount(
    space.id,
    accountSchema.parse({
      name: "Banco Azul",
      color: "blue",
      initialBalance: "1.000,00",
      initialBalanceDate: "2026-01-01",
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
  const category = (name: string) =>
    db.category.findFirstOrThrow({ where: { spaceId: space.id, name } });
  return {
    userId: user.id,
    spaceId: space.id,
    accountId: account.account.id,
    cardId: card.card.id,
    mercado: await category("Mercado"),
    lazer: await category("Lazer"),
    salario: await category("Salário"),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function spend(
  s: Setup,
  counterparty: string,
  amountCents: number,
  fields: Record<string, unknown> = {},
) {
  const today =
    (fields.today as string | undefined) ?? (fields.date as string | undefined) ?? "2026-11-15";
  delete fields.today;
  on(today);
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
      counterparty,
      ...fields,
    }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.transaction;
}

const idOf = async (s: Setup, name: string) =>
  (await db.counterparty.findFirstOrThrow({ where: { spaceId: s.spaceId, name } })).id;

describe("ranking", () => {
  it("CA2: só despesas do período; parcelada conta uma compra; cada cobrança de assinatura conta", async () => {
    const s = await setup();
    const bia = await setup("bia@example.com");
    await spend(s, "Mercado Central", 10_000);
    await spend(s, "Mercado Central", 5_000, { categoryId: s.lazer.id });
    await spend(s, "Mercado Central", 2_000);
    await spend(s, "Mercado Central", 99_999, { date: "2026-10-31" }); // last month
    await spend(s, "Mercado Central", 7_000, {
      type: "INCOME",
      categoryId: s.salario.id,
    }); // income: out
    // 3× of R$ 300 on 2026-09-20 (card): November has the 3rd installment only.
    await spend(s, "Loja de Móveis", 30_000, {
      date: "2026-09-20",
      method: "CREDIT",
      accountId: null,
      cardId: s.cardId,
      installments: 3,
    });
    await spend(s, "Loja de Móveis", 4_000, {
      method: "CREDIT",
      accountId: null,
      cardId: s.cardId,
      installments: 2,
    });
    // A subscription since September: one charge per month.
    await spend(s, "Streaming", 3_990, { date: "2026-09-05", subscription: true });
    on("2026-11-15");
    await generateRecurring(s.spaceId);
    await spend(bia, "Mercado Central", 1_000);

    const november = await counterpartyRanking(s.spaceId, "mes");
    const byName = Object.fromEntries(november.map((r) => [r.name, r]));
    expect(Object.keys(byName).sort()).toEqual(["Loja de Móveis", "Mercado Central", "Streaming"]);
    expect(byName["Mercado Central"]).toMatchObject({
      totalCents: 17_000,
      purchases: 3,
      category: { name: "Mercado" },
    });
    // The 3rd installment (R$ 100) in value, but not a purchase; the new 2× counts once.
    expect(byName["Loja de Móveis"]).toMatchObject({ totalCents: 10_000 + 2_000, purchases: 1 });
    expect(byName.Streaming).toMatchObject({ totalCents: 3_990, purchases: 1 });

    const quarter = Object.fromEntries(
      (await counterpartyRanking(s.spaceId, "3-meses")).map((r) => [r.name, r]),
    );
    expect(quarter.Streaming).toMatchObject({ totalCents: 3 * 3_990, purchases: 3 });
    expect(quarter["Loja de Móveis"]).toMatchObject({ totalCents: 30_000 + 2_000, purchases: 2 });
  });

  it("detalhe: total, compras, ticket médio e os lançamentos do período; outro espaço não vê", async () => {
    const s = await setup();
    const bia = await setup("bia@example.com");
    await spend(s, "Padaria", 1_000);
    await spend(s, "Padaria", 2_001);
    const id = await idOf(s, "Padaria");
    const detail = (await counterpartyDetail(s.spaceId, id, "mes"))!;
    expect(detail).toMatchObject({ totalCents: 3_001, purchases: 2, averageCents: 1_501 });
    expect(detail.items).toHaveLength(2);
    expect((await counterpartyDetail(s.spaceId, id, "mes-passado"))!).toMatchObject({
      totalCents: 0,
      purchases: 0,
      averageCents: null,
      items: [],
    });
    expect(await counterpartyDetail(bia.spaceId, id, "mes")).toBeNull();
  });
});

describe("editar a memória", () => {
  const memory = (over: Record<string, unknown> = {}) =>
    memorySchema.parse({
      name: "Padaria do bairro",
      aliases: ["PAG*PADARIA"],
      document: "12.345.678/0001-95",
      defaultCategoryId: "",
      defaultDescription: "Pão",
      ...over,
    });

  it("CA4: grava tudo; a categoria padrão vira a sugestão do registro", async () => {
    const s = await setup();
    await spend(s, "Padaria", 1_000);
    const id = await idOf(s, "Padaria");
    expect(
      await updateCounterparty(s.spaceId, id, memory({ defaultCategoryId: s.lazer.id })),
    ).toEqual({ ok: true });
    expect(await db.counterparty.findUniqueOrThrow({ where: { id } })).toMatchObject({
      name: "Padaria do bairro",
      nameKey: "padaria do bairro",
      aliases: ["PAG*PADARIA"],
      document: "12345678000195",
      defaultCategoryId: s.lazer.id,
      defaultDescription: "Pão",
    });
    const register = await registerData(s.spaceId);
    const option = register.counterparties.find((c) => c.id === id)!;
    expect(option.suggestions.EXPENSE).toEqual({ categoryId: s.lazer.id, description: "Pão" });
  });

  it("CA4: recusa nome repetido, categoria de outro espaço; outro espaço não edita", async () => {
    const s = await setup();
    const bia = await setup("bia@example.com");
    await spend(s, "Padaria", 1_000);
    await spend(s, "Padaria do Bairro", 1_000);
    const id = await idOf(s, "Padaria");
    expect(await updateCounterparty(s.spaceId, id, memory({ name: "PADARIA DO BAIRRO" }))).toEqual({
      ok: false,
      error: "NAME_TAKEN",
    });
    expect(
      await updateCounterparty(
        s.spaceId,
        id,
        memory({ name: "Outra", defaultCategoryId: bia.lazer.id }),
      ),
    ).toEqual({ ok: false, error: "CATEGORY_NOT_FOUND" });
    expect(await updateCounterparty(bia.spaceId, id, memory({ name: "Outra" }))).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });
});

describe("editar a memória: casos de borda", () => {
  const memory = (over: Record<string, unknown> = {}) =>
    memorySchema.parse({ name: "Padaria do bairro", aliases: [], defaultCategoryId: "", ...over });

  it("nome repetido só por acento também é recusado", async () => {
    const s = await setup();
    await spend(s, "Padaria", 1_000);
    await spend(s, "Padaria São João", 1_000);
    const id = await idOf(s, "Padaria");
    expect(await updateCounterparty(s.spaceId, id, memory({ name: "padaria sao joao" }))).toEqual({
      ok: false,
      error: "NAME_TAKEN",
    });
  });

  it("um órfão (sem lançamentos) com o nome não impede renomear: ele sai", async () => {
    const s = await setup();
    await spend(s, "Padaria", 1_000);
    const orphan = await db.counterparty.create({
      data: { spaceId: s.spaceId, name: "Padaria do bairro", nameKey: "padaria do bairro" },
    });
    const id = await idOf(s, "Padaria");
    expect(await updateCounterparty(s.spaceId, id, memory())).toEqual({ ok: true });
    expect(await db.counterparty.findUnique({ where: { id: orphan.id } })).toBeNull();
  });

  it("categoria arquivada é recusada, a não ser que já fosse a padrão", async () => {
    const s = await setup();
    await spend(s, "Padaria", 1_000);
    const id = await idOf(s, "Padaria");
    expect(
      await updateCounterparty(s.spaceId, id, memory({ defaultCategoryId: s.lazer.id })),
    ).toEqual({ ok: true });
    await db.category.update({ where: { id: s.lazer.id }, data: { archivedAt: new Date() } });
    expect(
      await updateCounterparty(
        s.spaceId,
        id,
        memory({ defaultCategoryId: s.lazer.id, defaultDescription: "Pão" }),
      ),
    ).toEqual({ ok: true });
    const other = await db.category.findFirstOrThrow({
      where: { spaceId: s.spaceId, name: "Transporte" },
    });
    await db.category.update({ where: { id: other.id }, data: { archivedAt: new Date() } });
    expect(
      await updateCounterparty(s.spaceId, id, memory({ defaultCategoryId: other.id })),
    ).toEqual({ ok: false, error: "CATEGORY_ARCHIVED" });
  });
});

describe("mesclar", () => {
  it("CA3: move lançamentos e assinaturas, junta apelidos, herda o que falta e apaga o absorvido", async () => {
    const s = await setup();
    await spend(s, "Padaria do bairro", 1_000);
    await spend(s, "Padaria Sao Joao", 2_000, {
      counterpartyAlias: "PAG*PADARIA SJ",
      counterpartyDocument: "12.345.678/0001-95",
    });
    await spend(s, "Padaria Sao Joao", 3_000, { date: "2026-10-05", subscription: true });
    const keep = await idOf(s, "Padaria do bairro");
    const absorbed = await idOf(s, "Padaria Sao Joao");
    await db.counterparty.update({
      where: { id: absorbed },
      data: { defaultCategoryId: s.lazer.id, defaultDescription: "Pão francês" },
    });

    expect(await mergePreview(s.spaceId, keep, absorbed)).toMatchObject({
      ok: true,
      entries: 2, // the purchase and the subscription's 1st charge
      subscriptions: 1,
      documentDropped: null,
    });
    expect(await mergeCounterparties(s.spaceId, keep, absorbed)).toEqual({ ok: true, moved: 2 });

    expect(await db.counterparty.findUnique({ where: { id: absorbed } })).toBeNull();
    expect(await db.transaction.count({ where: { counterpartyId: keep } })).toBe(3);
    expect(await db.recurringRule.count({ where: { counterpartyId: keep } })).toBe(1);
    expect(await db.counterparty.findUniqueOrThrow({ where: { id: keep } })).toMatchObject({
      aliases: ["PAG*PADARIA SJ", "Padaria Sao Joao"],
      document: "12345678000195",
      defaultCategoryId: s.lazer.id,
      defaultDescription: "Pão francês",
    });
    // The old name now finds the kept one.
    const again = await spend(s, "Padaria Sao Joao", 500);
    expect(again.counterparty?.id).toBe(keep);
  });

  it("CA3: recusa mesclar com ele mesmo e com outro espaço; avisa o documento descartado", async () => {
    const s = await setup();
    const bia = await setup("bia@example.com");
    await spend(s, "A", 1_000, { counterpartyDocument: "111.444.777-35" });
    await spend(s, "B", 1_000, { counterpartyDocument: "12.345.678/0001-95" });
    await spend(bia, "C", 1_000);
    const [a, b, c] = [await idOf(s, "A"), await idOf(s, "B"), await idOf(bia, "C")];
    expect(await mergeCounterparties(s.spaceId, a, a)).toEqual({
      ok: false,
      error: "SAME_COUNTERPARTY",
    });
    expect(await mergeCounterparties(s.spaceId, a, c)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await db.counterparty.count({ where: { id: c } })).toBe(1);
    expect(await mergePreview(s.spaceId, a, b)).toMatchObject({
      documentDropped: "12345678000195",
    });
  });
});
