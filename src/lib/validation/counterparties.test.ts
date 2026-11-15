import { describe, expect, it } from "vitest";

import { memorySchema } from "./counterparties";

const base = { name: "  Padaria do bairro ", aliases: [], document: "", defaultCategoryId: "" };
const issue = (input: object) => memorySchema.safeParse(input).error?.issues[0]?.message;

describe("memorySchema", () => {
  it("trims, cleans the aliases and normalizes the CPF/CNPJ; blanks are absent", () => {
    expect(
      memorySchema.parse({
        ...base,
        aliases: ["PAG*PADARIA", "pag*padaria", "padaria do bairro", " "],
        document: "12.345.678/0001-95",
        defaultDescription: "  ",
      }),
    ).toEqual({
      name: "Padaria do bairro",
      aliases: ["PAG*PADARIA"],
      document: "12345678000195",
      defaultCategoryId: null,
      defaultDescription: null,
    });
  });

  it("CA4: refuses an empty name, an invalid document and more than 10 aliases", () => {
    expect(issue({ ...base, name: " " })).toBe("Informe o nome.");
    expect(issue({ ...base, document: "123.456.789-00" })).toBe(
      "CPF inválido. Confira os números.",
    );
    expect(issue({ ...base, aliases: Array.from({ length: 11 }, (_, i) => `APELIDO ${i}`) })).toBe(
      "São no máximo 10 apelidos.",
    );
  });
});
