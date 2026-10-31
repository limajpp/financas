import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cycleOn, invoiceFor } from "@/domain/invoice-cycle";
import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { cardSchema } from "@/lib/validation/cards";
import { createAccount, setAccountArchived } from "@/server/accounts";
import { createCard, listCards, setCardArchived, updateCard } from "@/server/cards";
import { ensurePersonalSpace } from "@/server/spaces";
import { resetDatabase } from "@/test/db";

beforeEach(resetDatabase);
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

/** Freezes "now" (Date only, so Prisma's timers keep working) at noon in São Paulo. */
function today(date: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T15:00:00Z`));
}

async function spaceFor(email: string) {
  const user = await db.user.create({ data: { name: "Ana Teste", email } });
  return ensurePersonalSpace(user.id);
}

async function account(spaceId: string, name = "Banco Azul") {
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

const input = (accountId: string, overrides: Record<string, unknown> = {}) =>
  cardSchema.parse({
    name: "Cartão Roxo",
    accountId,
    closingDay: "5",
    dueDay: "12",
    limit: "",
    ...overrides,
  });

async function card(spaceId: string, accountId: string, overrides: Record<string, unknown> = {}) {
  const result = await createCard(spaceId, input(accountId, overrides));
  if (!result.ok) throw new Error(result.error);
  return result.card;
}

describe("cartões", () => {
  it("no dia em que o cartão foi criado, editar os dias corrige o ciclo inteiro", async () => {
    today("2026-10-31");
    const space = await spaceFor("ana@example.com");
    const azul = await account(space.id);
    const roxo = await card(space.id, azul.id, { closingDay: "5" });
    expect(roxo.createdToday).toBe(true);

    const result = await updateCard(
      space.id,
      roxo.id,
      input(azul.id, { closingDay: "25", dueDay: "5" }),
    );
    if (!result.ok) throw new Error(result.error);

    expect(result.card.cycles).toEqual([{ closingDay: 25, dueDay: 5, validFrom: "1900-01-01" }]);
    // A purchase from last week, entered now, uses the corrected days.
    expect(invoiceFor(cycleOn(result.card.cycles, "2026-10-24"), "2026-10-24")).toEqual({
      closingDate: "2026-10-25",
      dueDate: "2026-11-05",
    });

    today("2026-11-01");
    expect((await listCards(space.id))[0]?.createdToday).toBe(false);
  });

  it("cria com o ciclo inicial, a conta e a fatura aberta de hoje", async () => {
    today("2026-10-08");
    const space = await spaceFor("ana@example.com");
    const azul = await account(space.id);

    const created = await card(space.id, azul.id, { limit: "5.000,00" });

    expect(created).toMatchObject({
      name: "Cartão Roxo",
      limitCents: 500000,
      account: { id: azul.id, name: "Banco Azul" },
      closingDay: 5,
      dueDay: 12,
      openInvoice: { closingDate: "2026-11-05", dueDate: "2026-11-12" },
    });
    expect(created.cycles).toEqual([{ closingDay: 5, dueDay: 12, validFrom: "1900-01-01" }]);
  });

  it("trocar o fechamento vale a partir de hoje: a fatura de uma compra de ontem não muda", async () => {
    today("2026-10-09");
    const space = await spaceFor("ana@example.com");
    const azul = await account(space.id);
    const roxo = await card(space.id, azul.id);
    const before = invoiceFor(cycleOn(roxo.cycles, "2026-10-08"), "2026-10-08");

    today("2026-10-10");
    const result = await updateCard(
      space.id,
      roxo.id,
      input(azul.id, { closingDay: "20", dueDay: "27" }),
    );
    if (!result.ok) throw new Error(result.error);

    expect(result.card.cycles).toHaveLength(2);
    expect(result.card.cycles).toContainEqual({
      closingDay: 20,
      dueDay: 27,
      validFrom: "2026-10-10",
    });
    expect(invoiceFor(cycleOn(result.card.cycles, "2026-10-08"), "2026-10-08")).toEqual(before);
    expect(before).toEqual({ closingDate: "2026-11-05", dueDate: "2026-11-12" });
    expect(result.card.openInvoice).toEqual({ closingDate: "2026-10-20", dueDate: "2026-10-27" });
  });

  it("duas mudanças no mesmo dia substituem a versão do dia; mudar só o nome não cria versão", async () => {
    today("2026-10-09");
    const space = await spaceFor("ana@example.com");
    const azul = await account(space.id);
    const roxo = await card(space.id, azul.id);

    today("2026-10-10");

    await updateCard(space.id, roxo.id, input(azul.id, { closingDay: "20" }));
    await updateCard(space.id, roxo.id, input(azul.id, { closingDay: "22" }));
    await updateCard(space.id, roxo.id, input(azul.id, { closingDay: "22", name: "Roxinho" }));

    const cycles = await db.cardCycle.findMany({ where: { cardId: roxo.id } });
    expect(cycles).toHaveLength(2);
    expect(cycles.map((c) => c.closingDay).sort((a, b) => a - b)).toEqual([5, 22]);
  });

  it("recusa conta de outro espaço, conta arquivada num cartão novo e nome repetido", async () => {
    const ana = await spaceFor("ana@example.com");
    const bia = await spaceFor("bia@example.com");
    const contaDaAna = await account(ana.id);
    const contaDaBia = await account(bia.id);
    const arquivada = await account(bia.id, "Antiga");
    await setAccountArchived(bia.id, arquivada.id, true);

    expect(await createCard(bia.id, input(contaDaAna.id))).toEqual({
      ok: false,
      error: "ACCOUNT_NOT_FOUND",
    });
    expect(await createCard(bia.id, input(arquivada.id))).toEqual({
      ok: false,
      error: "ACCOUNT_ARCHIVED",
    });
    await card(bia.id, contaDaBia.id);
    expect(await createCard(bia.id, input(contaDaBia.id, { name: "CARTAO ROXO" }))).toEqual({
      ok: false,
      error: "DUPLICATE_NAME",
    });
    expect(await db.card.count({ where: { spaceId: bia.id } })).toBe(1);
  });

  it("um cartão mantém a conta que foi arquivada depois", async () => {
    const space = await spaceFor("ana@example.com");
    const azul = await account(space.id);
    const roxo = await card(space.id, azul.id);
    await setAccountArchived(space.id, azul.id, true);

    expect(await updateCard(space.id, roxo.id, input(azul.id, { name: "Roxinho" }))).toMatchObject({
      ok: true,
      card: { name: "Roxinho" },
    });
  });

  it("um usuário não lista, edita nem arquiva cartão de outro espaço", async () => {
    const ana = await spaceFor("ana@example.com");
    const bia = await spaceFor("bia@example.com");
    const contaDaAna = await account(ana.id);
    const contaDaBia = await account(bia.id);
    const cartaoDaAna = await card(ana.id, contaDaAna.id);

    expect(await listCards(bia.id, { includeArchived: true })).toEqual([]);
    expect(
      await updateCard(bia.id, cartaoDaAna.id, input(contaDaBia.id, { name: "Invadido" })),
    ).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await setCardArchived(bia.id, cartaoDaAna.id, true)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await db.card.findUniqueOrThrow({ where: { id: cartaoDaAna.id } })).toMatchObject({
      name: "Cartão Roxo",
      accountId: contaDaAna.id,
      archivedAt: null,
    });
  });

  it("arquivar tira da lista; o banco recusa dias fora de 1–31; apagar o usuário apaga tudo", async () => {
    const space = await spaceFor("ana@example.com");
    const azul = await account(space.id);
    const roxo = await card(space.id, azul.id);

    await setCardArchived(space.id, roxo.id, true);
    expect(await listCards(space.id)).toEqual([]);
    expect(await listCards(space.id, { includeArchived: true })).toHaveLength(1);

    await expect(
      db.cardCycle.create({
        data: { cardId: roxo.id, closingDay: 32, dueDay: 5, validFrom: new Date("2026-10-10") },
      }),
    ).rejects.toThrow();

    await db.user.delete({ where: { id: space.personalOwnerId! } });
    expect(await db.card.count()).toBe(0);
    expect(await db.cardCycle.count()).toBe(0);
  });
});
