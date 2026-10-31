import { describe, expect, it } from "vitest";

import { signInSchema, signUpSchema } from "./auth";

function firstError(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message;
}

const valid = { name: "Ana Teste", email: "ana@example.com", password: "senha-segura" };

describe("signUpSchema", () => {
  it("aceita dados válidos, normalizando nome e e-mail", () => {
    const result = signUpSchema.safeParse({
      ...valid,
      name: "  Ana Teste ",
      email: " Ana@Example.com ",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ...valid });
  });

  it("recusa nome vazio", () => {
    expect(firstError(signUpSchema.safeParse({ ...valid, name: "   " }))).toBe("Informe seu nome.");
  });

  it("recusa e-mail inválido", () => {
    expect(firstError(signUpSchema.safeParse({ ...valid, email: "ana@" }))).toBe(
      "E-mail inválido.",
    );
  });

  it("recusa senha com menos de 8 caracteres", () => {
    expect(firstError(signUpSchema.safeParse({ ...valid, password: "1234567" }))).toBe(
      "A senha precisa ter pelo menos 8 caracteres.",
    );
  });

  it("aceita senha com exatamente 8 e 128 caracteres", () => {
    expect(signUpSchema.safeParse({ ...valid, password: "a".repeat(8) }).success).toBe(true);
    expect(signUpSchema.safeParse({ ...valid, password: "a".repeat(128) }).success).toBe(true);
  });

  it("recusa senha com mais de 128 caracteres", () => {
    expect(firstError(signUpSchema.safeParse({ ...valid, password: "a".repeat(129) }))).toBe(
      "A senha pode ter no máximo 128 caracteres.",
    );
  });
});

describe("signInSchema", () => {
  it("aceita e-mail e senha", () => {
    expect(signInSchema.safeParse({ email: "ana@example.com", password: "x" }).success).toBe(true);
  });

  it("recusa senha vazia", () => {
    expect(firstError(signInSchema.safeParse({ email: "ana@example.com", password: "" }))).toBe(
      "Informe a senha.",
    );
  });
});
