import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ensureDefaultCategories } from "@/server/categories";

/**
 * Returns the user's personal space, creating it (with the OWNER membership and the default
 * categories) if missing. Also seeds the categories of an older space that never got them.
 * Safe to call concurrently: the unique personalOwnerId and the categoriesSeededAt mark settle races.
 */
export async function ensurePersonalSpace(userId: string) {
  const space = await findOrCreatePersonalSpace(userId);
  if (space.categoriesSeededAt === null) await ensureDefaultCategories(space.id);
  return space;
}

async function findOrCreatePersonalSpace(userId: string) {
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
