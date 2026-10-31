import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_CATEGORIES } from "@/domain/default-categories";
import { db } from "@/lib/db";
import { auth } from "@/server/auth";
import {
  createCategory,
  ensureDefaultCategories,
  listCategories,
  selectableCategories,
  setCategoryArchived,
  updateCategory,
} from "@/server/categories";
import { ensurePersonalSpace } from "@/server/spaces";
import { resetDatabase } from "@/test/db";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const DEFAULT_COUNT = DEFAULT_CATEGORIES.reduce((n, c) => n + 1 + (c.children?.length ?? 0), 0);

async function spaceFor(email: string) {
  const user = await db.user.create({ data: { name: "Ana Teste", email } });
  return ensurePersonalSpace(user.id);
}

const appearance = { icon: "Tag", color: "blue", isFixed: false } as const;

async function findByName(spaceId: string, name: string) {
  return db.category.findFirstOrThrow({ where: { spaceId, name } });
}

describe("lista padrão", () => {
  it("um usuário novo já tem a lista padrão completa", async () => {
    await auth.api.signUpEmail({
      body: { name: "Ana Teste", email: "ana@example.com", password: "senha-forte-123" },
    });
    const user = await db.user.findUniqueOrThrow({ where: { email: "ana@example.com" } });
    const space = await db.space.findUniqueOrThrow({ where: { personalOwnerId: user.id } });

    expect(space.categoriesSeededAt).not.toBeNull();
    expect(await db.category.count({ where: { spaceId: space.id } })).toBe(DEFAULT_COUNT);

    const moradia = await findByName(space.id, "Moradia");
    const aluguel = await findByName(space.id, "Aluguel");
    expect(aluguel).toMatchObject({
      parentId: moradia.id,
      type: "EXPENSE",
      isFixed: true,
      icon: moradia.icon,
      color: moradia.color,
    });
    expect(await findByName(space.id, "Salário")).toMatchObject({ type: "INCOME", isFixed: false });
  });

  it("chamar de novo, inclusive em paralelo, não duplica", async () => {
    const space = await spaceFor("ana@example.com");

    await Promise.all([
      ensureDefaultCategories(space.id),
      ensureDefaultCategories(space.id),
      ensurePersonalSpace(space.personalOwnerId!),
    ]);

    expect(await db.category.count()).toBe(DEFAULT_COUNT);
  });

  it("um espaço antigo sem a marca recebe a lista na próxima ensurePersonalSpace", async () => {
    const user = await db.user.create({ data: { name: "Ana Teste", email: "ana@example.com" } });
    const old = await db.space.create({
      data: {
        type: "PERSONAL",
        name: "Pessoal",
        personalOwnerId: user.id,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    expect(await db.category.count()).toBe(0);

    await ensurePersonalSpace(user.id);

    expect(await db.category.count({ where: { spaceId: old.id } })).toBe(DEFAULT_COUNT);
  });

  it("uma categoria padrão arquivada não volta", async () => {
    const space = await spaceFor("ana@example.com");
    const pets = await findByName(space.id, "Pets");
    await setCategoryArchived(space.id, pets.id, true);

    await ensurePersonalSpace(space.personalOwnerId!);

    expect(await db.category.count({ where: { name: "Pets" } })).toBe(1);
    expect((await findByName(space.id, "Pets")).archivedAt).not.toBeNull();
  });
});

describe("dois níveis", () => {
  it("recusa subcategoria de subcategoria, mãe arquivada e tipo diferente", async () => {
    const space = await spaceFor("ana@example.com");
    const aluguel = await findByName(space.id, "Aluguel");
    const salario = await findByName(space.id, "Salário");
    const pets = await findByName(space.id, "Pets");
    await setCategoryArchived(space.id, pets.id, true);

    const create = (parentId: string, type: "EXPENSE" | "INCOME" = "EXPENSE") =>
      createCategory(space.id, { name: "Nova", type, parentId, ...appearance });

    expect(await create(aluguel.id)).toEqual({ ok: false, error: "PARENT_IS_SUBCATEGORY" });
    expect(await create(pets.id)).toEqual({ ok: false, error: "PARENT_ARCHIVED" });
    expect(await create(salario.id)).toEqual({ ok: false, error: "TYPE_MISMATCH" });
    expect(await db.category.count({ where: { name: "Nova" } })).toBe(0);
  });

  it("cria uma subcategoria com o tipo da mãe", async () => {
    const space = await spaceFor("ana@example.com");
    const moradia = await findByName(space.id, "Moradia");

    const result = await createCategory(space.id, {
      name: "IPTU",
      type: "EXPENSE",
      parentId: moradia.id,
      ...appearance,
      isFixed: true,
    });

    expect(result).toMatchObject({
      ok: true,
      category: { parentId: moradia.id, type: "EXPENSE", isFixed: true },
    });
  });

  it("uma receita nunca fica fixa", async () => {
    const space = await spaceFor("ana@example.com");
    const result = await createCategory(space.id, {
      name: "Aluguel recebido",
      type: "INCOME",
      parentId: null,
      ...appearance,
      isFixed: true,
    });
    expect(result).toMatchObject({ ok: true, category: { isFixed: false } });
  });
});

describe("arquivar", () => {
  it("uma arquivada, ou filha de mãe arquivada, some das escolhas mas continua existindo", async () => {
    const space = await spaceFor("ana@example.com");
    const alimentacao = await findByName(space.id, "Alimentação");
    const farmacia = await findByName(space.id, "Farmácia");

    await setCategoryArchived(space.id, alimentacao.id, true);
    await setCategoryArchived(space.id, farmacia.id, true);

    const names = (tree: { name: string; children: { name: string }[] }[]) =>
      tree.flatMap((p) => [p.name, ...p.children.map((c) => c.name)]);

    const selectable = names(await selectableCategories(space.id, "EXPENSE"));
    expect(selectable).not.toContain("Alimentação");
    expect(selectable).not.toContain("Mercado");
    expect(selectable).not.toContain("Farmácia");
    expect(selectable).toContain("Saúde");

    expect(names(await listCategories(space.id))).not.toContain("Mercado");
    const all = names(await listCategories(space.id, { includeArchived: true }));
    expect(all).toEqual(expect.arrayContaining(["Alimentação", "Mercado", "Farmácia"]));
    expect(await db.category.count({ where: { spaceId: space.id } })).toBe(DEFAULT_COUNT);
  });

  it("não desarquiva a filha enquanto a mãe está arquivada", async () => {
    const space = await spaceFor("ana@example.com");
    const alimentacao = await findByName(space.id, "Alimentação");
    const mercado = await findByName(space.id, "Mercado");
    await setCategoryArchived(space.id, mercado.id, true);
    await setCategoryArchived(space.id, alimentacao.id, true);

    expect(await setCategoryArchived(space.id, mercado.id, false)).toEqual({
      ok: false,
      error: "PARENT_ARCHIVED",
    });
    await setCategoryArchived(space.id, alimentacao.id, false);
    expect(await setCategoryArchived(space.id, mercado.id, false)).toMatchObject({ ok: true });
  });
});

describe("isolamento entre espaços", () => {
  it("um usuário não lista, edita nem arquiva categoria de outro espaço", async () => {
    const ana = await spaceFor("ana@example.com");
    const bia = await spaceFor("bia@example.com");
    const moradiaDaAna = await findByName(ana.id, "Moradia");

    const listedByBia = await listCategories(bia.id, { includeArchived: true });
    expect(listedByBia.some((c) => c.id === moradiaDaAna.id)).toBe(false);

    expect(
      await updateCategory(bia.id, moradiaDaAna.id, { name: "Invadida", ...appearance }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await setCategoryArchived(bia.id, moradiaDaAna.id, true)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(
      await createCategory(bia.id, {
        name: "Filha",
        type: "EXPENSE",
        parentId: moradiaDaAna.id,
        ...appearance,
      }),
    ).toEqual({ ok: false, error: "PARENT_NOT_FOUND" });

    expect(await db.category.findUniqueOrThrow({ where: { id: moradiaDaAna.id } })).toMatchObject({
      name: "Moradia",
      archivedAt: null,
    });
  });
});

describe("editar", () => {
  it("renomeia, troca ícone, cor e fixa; recusa nome de irmã", async () => {
    const space = await spaceFor("ana@example.com");
    const pets = await findByName(space.id, "Pets");

    expect(
      await updateCategory(space.id, pets.id, {
        name: "lazer",
        icon: "Tag",
        color: "red",
        isFixed: false,
      }),
    ).toEqual({ ok: false, error: "DUPLICATE_NAME" });

    expect(
      await updateCategory(space.id, pets.id, {
        name: "Bichos",
        icon: "Tag",
        color: "red",
        isFixed: true,
      }),
    ).toMatchObject({
      ok: true,
      category: { name: "Bichos", icon: "Tag", color: "red", isFixed: true },
    });
  });

  it("apagar o usuário apaga o espaço e as categorias", async () => {
    const space = await spaceFor("ana@example.com");
    await db.user.delete({ where: { id: space.personalOwnerId! } });
    expect(await db.category.count()).toBe(0);
  });
});
