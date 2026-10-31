import { isAPIError } from "better-auth/api";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { auth } from "@/server/auth";
import { resetDatabase } from "@/test/db";

function apiError(status: string, code?: string) {
  return (error: unknown) =>
    isAPIError(error) &&
    error.status === status &&
    (code === undefined || error.body?.code === code);
}

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

describe("cadastro", () => {
  it("cria o usuário, o espaço pessoal e o membro OWNER", async () => {
    const { user } = await auth.api.signUpEmail({
      body: { name: "Ana Teste", email: "Ana@Example.com", password: "senha-segura" },
    });

    const stored = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { personalSpace: { include: { members: true } }, authAccounts: true },
    });
    expect(stored.email).toBe("ana@example.com");
    expect(stored.personalSpace).toMatchObject({ type: "PERSONAL", name: "Pessoal" });
    expect(stored.personalSpace?.members).toEqual([
      expect.objectContaining({ userId: user.id, role: "OWNER" }),
    ]);
    // Login credentials live in AuthAccount, with a hashed password.
    expect(stored.authAccounts).toEqual([expect.objectContaining({ providerId: "credential" })]);
    expect(stored.authAccounts[0].password).not.toBe("senha-segura");
  });

  it("recusa e-mail repetido, sem diferença de maiúsculas", async () => {
    const body = { name: "Ana Teste", email: "ana@example.com", password: "senha-segura" };
    await auth.api.signUpEmail({ body });

    await expect(
      auth.api.signUpEmail({ body: { ...body, email: "ANA@example.com" } }),
    ).rejects.toSatisfy(apiError("UNPROCESSABLE_ENTITY", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"));
    expect(await db.user.count()).toBe(1);
    expect(await db.space.count()).toBe(1);
  });

  it("entra com a senha certa e recusa a errada", async () => {
    const body = { name: "Ana Teste", email: "ana@example.com", password: "senha-segura" };
    await auth.api.signUpEmail({ body });

    const ok = await auth.api.signInEmail({ body: { email: body.email, password: body.password } });
    expect(ok.user.email).toBe("ana@example.com");

    await expect(
      auth.api.signInEmail({ body: { email: body.email, password: "senha-errada" } }),
    ).rejects.toSatisfy(apiError("UNAUTHORIZED", "INVALID_EMAIL_OR_PASSWORD"));
  });

  it("o servidor recusa nome vazio ou longo demais, mesmo sem passar pelo formulário", async () => {
    const body = { email: "ana@example.com", password: "senha-segura" };

    await expect(auth.api.signUpEmail({ body: { ...body, name: "   " } })).rejects.toSatisfy(
      apiError("BAD_REQUEST"),
    );
    await expect(
      auth.api.signUpEmail({ body: { ...body, name: "a".repeat(81) } }),
    ).rejects.toSatisfy(apiError("BAD_REQUEST"));
    expect(await db.user.count()).toBe(0);
  });

  it("guarda o nome sem espaços nas pontas", async () => {
    const { user } = await auth.api.signUpEmail({
      body: { name: "  Ana Teste  ", email: "ana@example.com", password: "senha-segura" },
    });

    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe("Ana Teste");
  });
});
