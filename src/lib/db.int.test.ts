import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { resetDatabase } from "@/test/db";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

function createUserWithPersonalSpace(email = "ana@example.com") {
  return db.user.create({
    data: {
      name: "Ana Teste",
      email,
      memberships: {
        create: { role: "OWNER", space: { create: { type: "PERSONAL", name: "Pessoal" } } },
      },
    },
    include: { memberships: { include: { space: true } } },
  });
}

describe("schema inicial", () => {
  it("cria usuário com espaço pessoal e membro OWNER, e lê de volta", async () => {
    const created = await createUserWithPersonalSpace();

    const user = await db.user.findUniqueOrThrow({
      where: { id: created.id },
      include: { memberships: { include: { space: true } } },
    });

    expect(user.email).toBe("ana@example.com");
    expect(user.emailVerified).toBe(false);
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0].role).toBe("OWNER");
    expect(user.memberships[0].space).toMatchObject({ type: "PERSONAL", name: "Pessoal" });
  });

  it("não aceita dois SpaceMember com o mesmo spaceId+userId", async () => {
    const user = await createUserWithPersonalSpace();
    const { spaceId } = user.memberships[0];

    const duplicate = db.spaceMember.create({
      data: { spaceId, userId: user.id, role: "MEMBER" },
    });

    await expect(duplicate).rejects.toSatisfy(
      (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
    );
  });

  it("apagar o usuário apaga os seus vínculos", async () => {
    const user = await createUserWithPersonalSpace();

    await db.user.delete({ where: { id: user.id } });

    expect(await db.spaceMember.count()).toBe(0);
    expect(await db.space.count()).toBe(1);
  });

  it("apagar o espaço apaga os seus vínculos, mas não o usuário", async () => {
    const user = await createUserWithPersonalSpace();

    await db.space.delete({ where: { id: user.memberships[0].spaceId } });

    expect(await db.spaceMember.count()).toBe(0);
    expect(await db.user.count()).toBe(1);
  });

  it("aceita o mesmo usuário em dois espaços diferentes", async () => {
    const user = await createUserWithPersonalSpace();
    const shared = await db.space.create({ data: { type: "SHARED", name: "Casa" } });

    await db.spaceMember.create({ data: { spaceId: shared.id, userId: user.id, role: "MEMBER" } });

    expect(await db.spaceMember.count({ where: { userId: user.id } })).toBe(2);
  });
});

describe("resetDatabase", () => {
  it("deixa todas as tabelas vazias", async () => {
    await createUserWithPersonalSpace("bia@example.com");

    await resetDatabase();

    expect(await db.user.count()).toBe(0);
    expect(await db.space.count()).toBe(0);
    expect(await db.spaceMember.count()).toBe(0);
  });

  it("preserva o histórico de migrations", async () => {
    await resetDatabase();

    const [{ count }] = await db.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM _prisma_migrations
    `;
    expect(count).toBeGreaterThan(0);
  });
});
