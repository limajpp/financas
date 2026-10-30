import { db } from "@/lib/db";

/** Empties every table in the test database, so each test starts from scratch. */
export async function resetDatabase() {
  // Checks the database the client is actually connected to, not just the env vars.
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (!name.endsWith("_test")) {
    throw new Error(
      `resetDatabase() só roda num banco *_test, mas o client está conectado em "${name}".`,
    );
  }
  const [{ tables }] = await db.$queryRaw<{ tables: string | null }[]>`
    SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') AS tables
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables) await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE`);
}
