import { execFileSync } from "node:child_process";

import "dotenv/config";

import { testDatabaseUrl } from "./database-url";

// Vitest can't print errors thrown here (its source-map step crashes), so the message also goes to stderr.
function fail(message: string): never {
  console.error(`\n${message}\n`);
  throw new Error(message);
}

// Brings the test database up to the latest migration once per run. Data is wiped per test by resetDatabase().
export default function setup() {
  let url: string;
  try {
    url = testDatabaseUrl();
  } catch (error) {
    fail((error as Error).message);
  }

  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    fail(
      `prisma migrate deploy falhou no banco de testes. O banco está de pé (npm run db:up)?\n${stderr ?? error}`,
    );
  }
}
