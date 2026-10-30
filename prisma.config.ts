import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Not env(): `prisma generate` runs on postinstall, where DATABASE_URL may be unset.
  datasource: { url: process.env.DATABASE_URL },
});
