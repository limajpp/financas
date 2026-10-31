import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ensurePersonalSpace } from "@/server/spaces";
import { resetDatabase } from "@/test/db";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const createUser = (email = "ana@example.com") =>
  db.user.create({ data: { name: "Ana Teste", email } });

function isKnownError(code: string) {
  return (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

describe("ensurePersonalSpace", () => {
  it("cria o espaço pessoal com o usuário como OWNER", async () => {
    const user = await createUser();

    const space = await ensurePersonalSpace(user.id);

    expect(space).toMatchObject({ type: "PERSONAL", name: "Pessoal", personalOwnerId: user.id });
    const members = await db.spaceMember.findMany({ where: { spaceId: space.id } });
    expect(members).toEqual([expect.objectContaining({ userId: user.id, role: "OWNER" })]);
  });

  it("é idempotente: a segunda chamada devolve o mesmo espaço", async () => {
    const user = await createUser();

    const first = await ensurePersonalSpace(user.id);
    const second = await ensurePersonalSpace(user.id);

    expect(second.id).toBe(first.id);
    expect(await db.space.count()).toBe(1);
    expect(await db.spaceMember.count()).toBe(1);
  });

  it("chamadas em paralelo deixam um espaço só", async () => {
    const user = await createUser();

    const spaces = await Promise.all(Array.from({ length: 5 }, () => ensurePersonalSpace(user.id)));

    expect(new Set(spaces.map((space) => space.id)).size).toBe(1);
    expect(await db.space.count()).toBe(1);
    expect(await db.spaceMember.count()).toBe(1);
  });

  it("não mexe no espaço pessoal de outro usuário", async () => {
    const ana = await createUser("ana@example.com");
    const bia = await createUser("bia@example.com");

    const anaSpace = await ensurePersonalSpace(ana.id);
    const biaSpace = await ensurePersonalSpace(bia.id);

    expect(biaSpace.id).not.toBe(anaSpace.id);
    expect(await db.spaceMember.count({ where: { spaceId: biaSpace.id, userId: ana.id } })).toBe(0);
  });
});

describe("restrições do banco", () => {
  it("recusa um segundo espaço PERSONAL para o mesmo usuário", async () => {
    const user = await createUser();
    await ensurePersonalSpace(user.id);

    const second = db.space.create({
      data: { type: "PERSONAL", name: "Outro", personalOwnerId: user.id },
    });

    await expect(second).rejects.toSatisfy(isKnownError("P2002"));
  });

  it("recusa um espaço PERSONAL sem dono", async () => {
    await expect(db.space.create({ data: { type: "PERSONAL", name: "Pessoal" } })).rejects.toThrow(
      /Space_personalOwner_check/,
    );
  });

  it("recusa um espaço SHARED com dono pessoal", async () => {
    const user = await createUser();
    const shared = db.space.create({
      data: { type: "SHARED", name: "Casa", personalOwnerId: user.id },
    });

    await expect(shared).rejects.toThrow(/Space_personalOwner_check/);
  });

  it("apagar o usuário apaga o espaço pessoal e os vínculos", async () => {
    const user = await createUser();
    await ensurePersonalSpace(user.id);

    await db.user.delete({ where: { id: user.id } });

    expect(await db.space.count()).toBe(0);
    expect(await db.spaceMember.count()).toBe(0);
  });
});
