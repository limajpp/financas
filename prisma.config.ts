import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Migrations need a direct connection: Neon's pooled URL (DATABASE_URL in production) doesn't work
  // for them. Not env(): `prisma generate` runs on postinstall, where neither may be set.
  datasource: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL },
});
