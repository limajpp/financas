import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_ALIASES } from "@/domain/counterparty-memory";
import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { entrySchema } from "@/lib/validation/transactions";
import { createAccount } from "@/server/accounts";
import { setCategoryArchived } from "@/server/categories";
import { counterpartyMemory, registerData } from "@/server/register";
import { ensurePersonalSpace } from "@/server/spaces";
import { createTransaction } from "@/server/transactions";
import { resetDatabase } from "@/test/db";

beforeEach(resetDatabase);
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

let minute = 0;
/** Freezes "now" in São Paulo on 2026-10-31; each call moves a minute ahead. */
function tick() {
  vi.useFakeTimers({ toFake: ["Date"] });
  minute += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 31, 15, minute)));
}

async function owner(email: string) {
  tick();
  const user = await db.user.create({ data: { name: "Ana Teste", email } });
  const space = await ensurePersonalSpace(user.id);
  const result = await createAccount(
    space.id,
    accountSchema.parse({
      name: "Banco Azul",
      color: "blue",
      initialBalance: "0",
      initialBalanceDate: "2026-10-01",
    }),
  );
  if (!result.ok) throw new Error(result.error);
  const category = (name: string) =>
    db.category.findFirstOrThrow({ where: { spaceId: space.id, name } });
  return { userId: user.id, spaceId: space.id, accountId: result.account.id, category };
}

type Owner = Awaited<ReturnType<typeof owner>>;

async function create(who: Owner, fields: Record<string, unknown>) {
  tick();
  const result = await createTransaction(
    who.spaceId,
    who.userId,
    randomUUID(),
    entrySchema.parse({
      type: "EXPENSE",
      amountCents: 1_000,
      date: "2026-10-20",
      method: "PIX",
      accountId: who.accountId,
      ...fields,
    }),
  );
  if (!result.ok) throw new Error(result.error);
  return result.transaction;
}

const memoryOf = async (who: Owner, name: string) =>
  (await registerData(who.spaceId)).counterparties.find((c) => c.name === name);

describe("memória por estabelecimento", () => {
  it("CA5: sugere a categoria mais usada (empate: a mais recente) e a observação mais recente", async () => {
    const ana = await owner("ana@example.com");
    const padaria = await ana.category("Padaria e lanches");
    const mercado = await ana.category("Mercado");
    const salario = await ana.category("Salário");

    await create(ana, { counterparty: "Padaria do Bairro", categoryId: mercado.id });
    await create(ana, {
      counterparty: "Padaria do Bairro",
      categoryId: padaria.id,
      description: "Pão",
    });
    await create(ana, { counterparty: "padaria do bairro", categoryId: padaria.id });
    await create(ana, { counterparty: "Padaria do Bairro", categoryId: null, description: "Café" });
    await create(ana, {
      type: "INCOME",
      method: "PIX",
      counterparty: "Padaria do Bairro",
      categoryId: salario.id,
    });

    expect(await memoryOf(ana, "Padaria do Bairro")).toMatchObject({
      useCount: 5,
      recentCount: 5,
      suggestions: {
        EXPENSE: { categoryId: padaria.id, description: "Café" },
        INCOME: { categoryId: salario.id, description: null },
      },
    });

    // Tie (2 × 2): the most recently used wins.
    await create(ana, { counterparty: "Padaria do Bairro", categoryId: mercado.id });
    expect((await memoryOf(ana, "Padaria do Bairro"))?.suggestions.EXPENSE.categoryId).toBe(
      mercado.id,
    );

    // Archived: not suggested; the next one is.
    await setCategoryArchived(ana.spaceId, mercado.id, true);
    expect((await memoryOf(ana, "Padaria do Bairro"))?.suggestions.EXPENSE.categoryId).toBe(
      padaria.id,
    );
  });

  it("CA5: categoria com a mãe arquivada não é sugerida", async () => {
    const ana = await owner("ana@example.com");
    const padaria = await ana.category("Padaria e lanches");
    const alimentacao = await ana.category("Alimentação");
    await create(ana, { counterparty: "Padaria do Bairro", categoryId: padaria.id });
    await setCategoryArchived(ana.spaceId, alimentacao.id, true);
    expect((await memoryOf(ana, "Padaria do Bairro"))?.suggestions.EXPENSE.categoryId).toBeNull();
  });

  it("leva só os usados mais recentemente, até o limite", async () => {
    const ana = await owner("ana@example.com");
    for (const name of ["Antigo", "Meio", "Recente"]) await create(ana, { counterparty: name });
    const none = { EXPENSE: new Set<string>(), INCOME: new Set<string>() };
    const kept = await counterpartyMemory(ana.spaceId, none, 2);
    expect(kept.map((c) => c.name)).toEqual(["Recente", "Meio"]);
  });

  it("CA5: sem estabelecimentos órfãos nem de outro espaço", async () => {
    const ana = await owner("ana@example.com");
    const bia = await owner("bia@example.com");
    await create(ana, { counterparty: "Mercado Central" });
    await create(bia, { counterparty: "Feira da Bia" });
    await db.counterparty.create({
      data: { spaceId: ana.spaceId, name: "Órfão", nameKey: "orfao" },
    });

    const names = (await registerData(ana.spaceId)).counterparties.map((c) => c.name);
    expect(names).toEqual(["Mercado Central"]);
  });

  it("CA6: guarda o apelido e o documento; sem apelido repetido; no máximo 10", async () => {
    const ana = await owner("ana@example.com");
    await create(ana, {
      counterparty: "Padaria do Bairro",
      counterpartyAlias: "PAG*JOSE SILVA",
      counterpartyDocument: "529.982.247-25",
    });
    await create(ana, { counterparty: "Padaria do Bairro", counterpartyAlias: "pag*jose silva" });

    expect(await memoryOf(ana, "Padaria do Bairro")).toMatchObject({
      aliases: ["PAG*JOSE SILVA"],
      document: "52998224725",
    });

    for (let i = 0; i < MAX_ALIASES; i++) {
      await create(ana, { counterparty: "Padaria do Bairro", counterpartyAlias: `PIX ${i}` });
    }
    const aliases = (await memoryOf(ana, "Padaria do Bairro"))?.aliases;
    expect(aliases).toHaveLength(MAX_ALIASES);
    expect(aliases?.[0]).toBe("PIX 0");
    expect(aliases?.at(-1)).toBe(`PIX ${MAX_ALIASES - 1}`);

    // A new CPF/CNPJ replaces the old one.
    await create(ana, {
      counterparty: "Padaria do Bairro",
      counterpartyDocument: "11222333000181",
    });
    expect((await memoryOf(ana, "Padaria do Bairro"))?.document).toBe("11222333000181");
  });

  it("CA6: texto igual ao apelido ou ao documento de um único estabelecimento vai para ele", async () => {
    const ana = await owner("ana@example.com");
    const first = await create(ana, {
      counterparty: "Padaria do Bairro",
      counterpartyAlias: "PAG*JOSE SILVA",
      counterpartyDocument: "11.222.333/0001-81",
    });

    const byAlias = await create(ana, { counterparty: "PAG*JOSE SILVA" });
    const byDocument = await create(ana, { counterparty: "11.222.333/0001-81" });
    expect(byAlias.counterparty?.id).toBe(first.counterparty?.id);
    expect(byDocument.counterparty?.id).toBe(first.counterparty?.id);
    expect(await db.counterparty.count({ where: { spaceId: ana.spaceId } })).toBe(1);
  });

  it("CA6: se dois têm o mesmo apelido ou documento, o texto vira um estabelecimento novo", async () => {
    const ana = await owner("ana@example.com");
    for (const name of ["Loja 1", "Loja 2"]) {
      await create(ana, {
        counterparty: name,
        counterpartyAlias: "PAGSEGURO",
        counterpartyDocument: "12.345.678/0001-95",
      });
    }
    const byAlias = await create(ana, { counterparty: "PAGSEGURO" });
    const byDocument = await create(ana, { counterparty: "12.345.678/0001-95" });
    expect(byAlias.counterparty?.name).toBe("PAGSEGURO");
    expect(byDocument.counterparty?.name).toBe("12.345.678/0001-95");
    expect(await db.counterparty.count({ where: { spaceId: ana.spaceId } })).toBe(4);
  });

  it("um órfão (lançamento desfeito) não deixa o apelido ambíguo; apelido igual ao nome não entra", async () => {
    const ana = await owner("ana@example.com");
    const lojaX = await create(ana, { counterparty: "Loja X", counterpartyAlias: "PAGSEGURO" });
    await db.transaction.delete({ where: { id: lojaX.id } }); // "Desfazer"
    const lojaY = await create(ana, { counterparty: "Loja Y", counterpartyAlias: "PAGSEGURO" });
    const typed = await create(ana, { counterparty: "pagseguro" });
    expect(typed.counterparty?.id).toBe(lojaY.counterparty?.id);

    await create(ana, { counterparty: "Loja Y", counterpartyAlias: "loja y" });
    expect((await memoryOf(ana, "Loja Y"))?.aliases).toEqual(["PAGSEGURO"]);
  });

  it("CA6: o apelido e o documento de outro espaço não resolvem", async () => {
    const ana = await owner("ana@example.com");
    const bia = await owner("bia@example.com");
    await create(bia, { counterparty: "Feira da Bia", counterpartyAlias: "PIX BIA" });
    const mine = await create(ana, { counterparty: "PIX BIA" });
    expect(mine.counterparty?.name).toBe("PIX BIA");
    expect(await db.counterparty.count({ where: { spaceId: ana.spaceId } })).toBe(1);
  });
});
