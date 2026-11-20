import { describe, expect, it } from "vitest";

import { applyPick, leavePick, type PrefillFields } from "./prefill";

const empty: PrefillFields = { categoryId: null, description: "", document: "" };
const padaria = {
  name: "Padaria",
  categoryId: "alimentacao",
  description: "Pão",
  document: "11.222.333/0001-81",
};
const mercado = { name: "Mercado", categoryId: "mercado", description: null, document: null };

describe("applyPick", () => {
  it("fills the empty fields and remembers what it filled", () => {
    expect(applyPick(empty, null, padaria)).toEqual({
      fields: { categoryId: "alimentacao", description: "Pão", document: "11.222.333/0001-81" },
      prefill: padaria,
    });
  });

  it("keeps what the user chose or typed", () => {
    const typed = { categoryId: "lazer", description: "Presente", document: "529.982.247-25" };
    expect(applyPick(typed, null, padaria)).toEqual({
      fields: typed,
      prefill: { name: "Padaria", categoryId: null, description: "", document: "" },
    });
  });

  it("a second pick replaces what the first one filled, even with nothing", () => {
    const first = applyPick(empty, null, padaria);
    expect(applyPick(first.fields, first.prefill, mercado)).toEqual({
      fields: { categoryId: "mercado", description: "", document: "" },
      prefill: { name: "Mercado", categoryId: "mercado", description: "", document: "" },
    });
  });

  it("…but not a field the user changed after the first pick", () => {
    const first = applyPick(empty, null, padaria);
    const edited = { ...first.fields, document: "529.982.247-25" };
    expect(applyPick(edited, first.prefill, mercado).fields.document).toBe("529.982.247-25");
  });
});

describe("applyPick: the same pick twice (touchend and click)", () => {
  it("gives the same fields and prefill", () => {
    const first = applyPick(empty, null, padaria);
    expect(applyPick(first.fields, first.prefill, padaria)).toEqual(first);
    expect(applyPick(empty, null, padaria)).toEqual(first);
  });
});

describe("leavePick", () => {
  it("clears what the pick filled and the user didn't touch", () => {
    const { fields, prefill } = applyPick(empty, null, padaria);
    expect(leavePick({ ...fields, description: "Pão de queijo" }, prefill)).toEqual({
      categoryId: null,
      description: "Pão de queijo",
      document: "",
    });
  });

  it("without a pick, nothing changes", () => {
    const typed = { categoryId: "lazer", description: "x", document: "y" };
    expect(leavePick(typed, null)).toEqual(typed);
  });
});
