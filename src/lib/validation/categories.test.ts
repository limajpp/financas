import { describe, expect, it } from "vitest";

import { createCategorySchema, updateCategorySchema } from "./categories";

const valid = {
  name: "  Pets ",
  type: "EXPENSE",
  parentId: null,
  icon: "PawPrint",
  color: "amber",
  isFixed: false,
};

describe("createCategorySchema", () => {
  it("trims the name", () => {
    expect(createCategorySchema.parse(valid).name).toBe("Pets");
  });

  it("refuses empty or long names, unknown icons and colors, with pt-BR messages", () => {
    const issues = (input: object) =>
      createCategorySchema.safeParse({ ...valid, ...input }).error?.issues.map((i) => i.message);
    expect(issues({ name: "   " })).toEqual(["Informe o nome."]);
    expect(issues({ name: "a".repeat(41) })).toEqual(["O nome pode ter no máximo 40 caracteres."]);
    expect(issues({ icon: "Skull" })).toEqual(["Ícone inválido."]);
    expect(issues({ color: "#ff0000" })).toEqual(["Cor inválida."]);
    expect(issues({ parentId: "abc" })).toEqual(["Categoria principal inválida."]);
  });
});

describe("updateCategorySchema", () => {
  it("ignores type and parent (they never change)", () => {
    const parsed = updateCategorySchema.parse({ ...valid, type: "INCOME", parentId: "x" });
    expect(parsed).toEqual({ name: "Pets", icon: "PawPrint", color: "amber", isFixed: false });
  });
});
