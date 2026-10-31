import { describe, expect, it } from "vitest";

import {
  buildCategoryTree,
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  type CategoryNode,
  fixedFlagFor,
  isArchivedEffective,
  isFixedEffective,
  normalizeCategoryName,
  selectableTree,
  validateNewCategory,
  validateRename,
  validateUnarchive,
} from "./categories";
import { DEFAULT_CATEGORIES } from "./default-categories";

let seq = 0;
function cat(overrides: Partial<CategoryNode> = {}): CategoryNode {
  seq += 1;
  return {
    id: `c${seq}`,
    parentId: null,
    name: `Categoria ${seq}`,
    type: "EXPENSE",
    isFixed: false,
    archivedAt: null,
    ...overrides,
  };
}

describe("normalizeCategoryName", () => {
  it("ignores accents, case and extra spaces", () => {
    expect(normalizeCategoryName("  Saúde   Mental ")).toBe("saude mental");
    expect(normalizeCategoryName("ALIMENTAÇÃO")).toBe(normalizeCategoryName("alimentacao"));
  });
});

describe("validateNewCategory", () => {
  const moradia = cat({ name: "Moradia" });
  const aluguel = cat({ name: "Aluguel", parentId: moradia.id });
  const salario = cat({ name: "Salário", type: "INCOME" });
  const archived = cat({ name: "Velha", archivedAt: new Date() });
  const existing = [moradia, aluguel, salario, archived];

  it("accepts a top-level category and a subcategory of a top-level one", () => {
    expect(
      validateNewCategory({ name: "Pets", type: "EXPENSE", parentId: null }, existing),
    ).toEqual({ ok: true, value: { type: "EXPENSE" } });
    expect(
      validateNewCategory({ name: "Condomínio", type: "EXPENSE", parentId: moradia.id }, existing),
    ).toEqual({ ok: true, value: { type: "EXPENSE" } });
  });

  it("refuses a subcategory of a subcategory", () => {
    expect(
      validateNewCategory({ name: "Multa", type: "EXPENSE", parentId: aluguel.id }, existing),
    ).toEqual({ ok: false, error: "PARENT_IS_SUBCATEGORY" });
  });

  it("refuses a parent that isn't in the space", () => {
    expect(
      validateNewCategory({ name: "X", type: "EXPENSE", parentId: "outro-espaco" }, existing),
    ).toEqual({ ok: false, error: "PARENT_NOT_FOUND" });
  });

  it("refuses an archived parent", () => {
    expect(
      validateNewCategory({ name: "X", type: "EXPENSE", parentId: archived.id }, existing),
    ).toEqual({ ok: false, error: "PARENT_ARCHIVED" });
  });

  it("refuses a subcategory of another type", () => {
    expect(
      validateNewCategory({ name: "Bônus", type: "EXPENSE", parentId: salario.id }, existing),
    ).toEqual({ ok: false, error: "TYPE_MISMATCH" });
  });

  it("refuses a repeated sibling name regardless of case and accents", () => {
    expect(
      validateNewCategory({ name: "MORADIA", type: "EXPENSE", parentId: null }, existing),
    ).toEqual({ ok: false, error: "DUPLICATE_NAME" });
    expect(
      validateNewCategory({ name: "aluguél", type: "EXPENSE", parentId: moradia.id }, existing),
    ).toEqual({ ok: false, error: "DUPLICATE_NAME" });
  });

  it("counts archived siblings as taken", () => {
    expect(
      validateNewCategory({ name: "velha", type: "EXPENSE", parentId: null }, existing),
    ).toEqual({ ok: false, error: "DUPLICATE_NAME" });
  });

  it("allows the same name under different parents or types", () => {
    const transporte = cat({ name: "Transporte" });
    const list = [...existing, transporte, cat({ name: "Manutenção", parentId: moradia.id })];
    expect(
      validateNewCategory({ name: "Manutenção", type: "EXPENSE", parentId: transporte.id }, list),
    ).toMatchObject({ ok: true });
    expect(
      validateNewCategory({ name: "Moradia", type: "INCOME", parentId: null }, list),
    ).toMatchObject({ ok: true });
  });
});

describe("validateRename", () => {
  const moradia = cat({ name: "Moradia" });
  const lazer = cat({ name: "Lazer" });

  it("lets a category keep its own name with another casing", () => {
    expect(validateRename(moradia, "MORADIA", [moradia, lazer])).toMatchObject({ ok: true });
  });

  it("refuses a sibling's name", () => {
    expect(validateRename(moradia, "lazer", [moradia, lazer])).toEqual({
      ok: false,
      error: "DUPLICATE_NAME",
    });
  });
});

describe("validateUnarchive", () => {
  it("refuses a subcategory whose parent is archived", () => {
    const parent = cat({ archivedAt: new Date() });
    const child = cat({ parentId: parent.id, archivedAt: new Date() });
    expect(validateUnarchive(child, [parent, child])).toEqual({
      ok: false,
      error: "PARENT_ARCHIVED",
    });
    expect(validateUnarchive(parent, [parent, child])).toMatchObject({ ok: true });
  });
});

describe("fixed and archived flags", () => {
  it("a subcategory is fixed through its parent; income is never fixed", () => {
    const parent = cat({ isFixed: true });
    expect(isFixedEffective(cat({ parentId: parent.id }), parent)).toBe(true);
    expect(isFixedEffective(cat({ isFixed: true }))).toBe(true);
    expect(isFixedEffective(cat())).toBe(false);
    expect(isFixedEffective(cat({ type: "INCOME", isFixed: true }))).toBe(false);
    expect(fixedFlagFor("INCOME", true)).toBe(false);
    expect(fixedFlagFor("EXPENSE", true)).toBe(true);
  });

  it("a subcategory is archived through its parent", () => {
    const parent = cat({ archivedAt: new Date() });
    expect(isArchivedEffective(cat({ parentId: parent.id }), parent)).toBe(true);
    expect(isArchivedEffective(cat())).toBe(false);
  });
});

describe("buildCategoryTree and selectableTree", () => {
  const saude = cat({ name: "Saúde" });
  const alimentacao = cat({ name: "Alimentação" });
  const mercado = cat({ name: "Mercado", parentId: alimentacao.id });
  const delivery = cat({ name: "Delivery", parentId: alimentacao.id });
  const velha = cat({ name: "Antiga", parentId: alimentacao.id, archivedAt: new Date() });
  const arquivada = cat({ name: "Bichos", archivedAt: new Date() });
  const filhaDeArquivada = cat({ name: "Ração", parentId: arquivada.id });
  const salario = cat({ name: "Salário", type: "INCOME" });
  const all = [saude, mercado, salario, alimentacao, delivery, velha, arquivada, filhaDeArquivada];

  it("sorts parents and children in pt-BR order", () => {
    const tree = buildCategoryTree(all.filter((c) => c.type === "EXPENSE"));
    expect(tree.map((c) => c.name)).toEqual(["Alimentação", "Bichos", "Saúde"]);
    expect(tree[0]?.children.map((c) => c.name)).toEqual(["Antiga", "Delivery", "Mercado"]);
  });

  it("drops archived categories and children of archived parents from the picker", () => {
    const tree = selectableTree(all, "EXPENSE");
    expect(tree.map((c) => c.name)).toEqual(["Alimentação", "Saúde"]);
    expect(tree[0]?.children.map((c) => c.name)).toEqual(["Delivery", "Mercado"]);
    expect(selectableTree(all, "INCOME").map((c) => c.name)).toEqual(["Salário"]);
  });
});

describe("DEFAULT_CATEGORIES", () => {
  it("uses only known icons and colors, and income is never fixed", () => {
    for (const parent of DEFAULT_CATEGORIES) {
      expect(CATEGORY_ICONS).toContain(parent.icon);
      expect(CATEGORY_COLORS).toContain(parent.color);
      for (const child of parent.children ?? []) {
        if (child.icon) expect(CATEGORY_ICONS).toContain(child.icon);
      }
      if (parent.type === "INCOME") {
        expect(parent.isFixed ?? false).toBe(false);
        expect(parent.children ?? []).toEqual([]);
      }
    }
  });

  it("passes its own rules (no repeated sibling names)", () => {
    const seen: CategoryNode[] = [];
    for (const parent of DEFAULT_CATEGORIES) {
      const p = cat({ name: parent.name, type: parent.type });
      expect(validateNewCategory({ ...parent, parentId: null }, seen)).toMatchObject({ ok: true });
      seen.push(p);
      for (const child of parent.children ?? []) {
        expect(
          validateNewCategory({ name: child.name, type: parent.type, parentId: p.id }, seen),
        ).toMatchObject({ ok: true });
        seen.push(cat({ name: child.name, type: parent.type, parentId: p.id }));
      }
    }
  });
});
