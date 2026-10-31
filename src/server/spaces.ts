import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * Returns the user's personal space, creating it (with the OWNER membership) if missing.
 * Safe to call concurrently: the unique personalOwnerId settles races.
 */
export async function ensurePersonalSpace(userId: string) {
  const existing = await db.space.findUnique({ where: { personalOwnerId: userId } });
  if (existing) return existing;

  try {
    // Nested create: Space and SpaceMember go in together. Set the scalar personalOwnerId, never
    // `personalOwner: { connect }`: on a 1:1 relation Prisma would first detach any existing personal space.
    return await db.space.create({
      data: {
        type: "PERSONAL",
        name: "Pessoal",
        personalOwnerId: userId,
        members: { create: { userId, role: "OWNER" } },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return db.space.findUniqueOrThrow({ where: { personalOwnerId: userId } });
    }
    throw error;
  }
}
