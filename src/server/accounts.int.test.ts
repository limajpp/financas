import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { todayInSaoPaulo } from "@/domain/dates";
import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import {
  createAccount,
  listAccounts,
  selectableAccounts,
  setAccountArchived,
  updateAccount,
} from "@/server/accounts";
import { ensurePersonalSpace } from "@/server/spaces";
import { resetDatabase } from "@/test/db";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function spaceFor(email: string) {
  const user = await db.user.create({ data: { name: "Ana Teste", email } });
  return ensurePersonalSpace(user.id);
}

const input = (overrides: Record<string, unknown> = {}) =>
  accountSchema.parse({
    name: "Banco Azul",
    color: "blue",
    initialBalance: "1.234,56",
    negative: false,
    initialBalanceDate: "2026-10-01",
    ...overrides,
  });

async function create(spaceId: string, overrides: Record<string, unknown> = {}) {
  const result = await createAccount(spaceId, input(overrides));
  if (!result.ok) throw new Error(result.error);
  return result.account;
}

describe("contas", () => {
  it("grava o saldo em centavos e a data como dia de calendário", async () => {
    const space = await spaceFor("ana@example.com");
    const account = await create(space.id);

    expect(account).toMatchObject({
      initialBalanceCents: 123456,
      initialBalanceDate: "2026-10-01",
    });
    const [{ day }] = await db.$queryRaw<{ day: string }[]>`
      SELECT "initialBalanceDate"::text AS day FROM "Account" WHERE id = ${account.id}`;
    expect(day).toBe("2026-10-01");
  });

  it("aceita saldo inicial negativo (cheque especial)", async () => {
    const space = await spaceFor("ana@example.com");
    const account = await create(space.id, { initialBalance: "350,00", negative: true });
    expect(account.initialBalanceCents).toBe(-35000);
  });

  it("recusa nome repetido (maiúsculas e acentos) e data no futuro", async () => {
    const space = await spaceFor("ana@example.com");
    await create(space.id, { name: "Poupança" });

    expect(await createAccount(space.id, input({ name: "POUPANCA" }))).toEqual({
      ok: false,
      error: "DUPLICATE_NAME",
    });

    const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000);
    expect(
      await createAccount(
        space.id,
        input({ name: "Outra", initialBalanceDate: todayInSaoPaulo(tomorrow) }),
      ),
    ).toEqual({ ok: false, error: "FUTURE_DATE" });
    expect(await db.account.count()).toBe(1);
  });

  it("usa hoje em São Paulo como limite da data", async () => {
    const space = await spaceFor("ana@example.com");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // 23:30 in Brasília on Oct 31 is already Nov 1 in UTC.
      vi.setSystemTime(new Date("2026-11-01T02:30:00Z"));
      expect(await createAccount(space.id, input({ initialBalanceDate: "2026-11-01" }))).toEqual({
        ok: false,
        error: "FUTURE_DATE",
      });
      expect(
        await createAccount(space.id, input({ initialBalanceDate: "2026-10-31" })),
      ).toMatchObject({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("edita nome, cor, saldo e data; mantém o próprio nome", async () => {
    const space = await spaceFor("ana@example.com");
    const account = await create(space.id);

    const result = await updateAccount(
      space.id,
      account.id,
      input({
        name: "BANCO AZUL",
        color: "red",
        initialBalance: "10",
        initialBalanceDate: "2026-09-30",
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      account: {
        name: "BANCO AZUL",
        color: "red",
        initialBalanceCents: 1000,
        initialBalanceDate: "2026-09-30",
      },
    });
  });

  it("arquivada some das escolhas e da lista, mas continua existindo", async () => {
    const space = await spaceFor("ana@example.com");
    const azul = await create(space.id);
    await create(space.id, { name: "Carteira" });

    await setAccountArchived(space.id, azul.id, true);

    expect((await selectableAccounts(space.id)).map((a) => a.name)).toEqual(["Carteira"]);
    expect((await listAccounts(space.id)).map((a) => a.name)).toEqual(["Carteira"]);
    expect((await listAccounts(space.id, { includeArchived: true })).map((a) => a.name)).toEqual([
      "Banco Azul",
      "Carteira",
    ]);

    await setAccountArchived(space.id, azul.id, false);
    expect(await selectableAccounts(space.id)).toHaveLength(2);
  });

  it("um usuário não lista, edita nem arquiva conta de outro espaço", async () => {
    const ana = await spaceFor("ana@example.com");
    const bia = await spaceFor("bia@example.com");
    const contaDaAna = await create(ana.id);

    expect(await listAccounts(bia.id, { includeArchived: true })).toEqual([]);
    expect(await updateAccount(bia.id, contaDaAna.id, input({ name: "Invadida" }))).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await setAccountArchived(bia.id, contaDaAna.id, true)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(await db.account.findUniqueOrThrow({ where: { id: contaDaAna.id } })).toMatchObject({
      name: "Banco Azul",
      archivedAt: null,
    });
  });

  it("apagar o usuário apaga as contas", async () => {
    const space = await spaceFor("ana@example.com");
    await create(space.id);
    await db.user.delete({ where: { id: space.personalOwnerId! } });
    expect(await db.account.count()).toBe(0);
  });
});
