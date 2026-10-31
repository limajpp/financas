import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  // Without it, pg silently falls back to the PG* defaults (localhost:5432), which may be another database.
  if (!connectionString) throw new Error("DATABASE_URL não está definida. Veja o .env.example.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// In dev, hot reload re-evaluates this module; reusing the client avoids opening new pools.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db = globalForDb.db ?? createClient();

if (process.env.NODE_ENV !== "production") globalForDb.db = db;
