import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/lib/db";
import { ensurePersonalSpace } from "@/server/spaces";

// Secret and base URL come from BETTER_AUTH_SECRET and BETTER_AUTH_URL.
export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql", transaction: true }),
  emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
  // Better Auth's "account" holds login credentials; ours is the bank account (task 6).
  account: { modelName: "authAccount" },
  // Only the HTTP handler (/api/auth/*) is rate limited, not auth.api.* calls, so sign-in and
  // sign-up go through the client. AUTH_RATE_LIMIT=off disables it (e2e), =on forces it outside production.
  rateLimit: {
    enabled:
      process.env.AUTH_RATE_LIMIT === "on" ||
      (process.env.NODE_ENV === "production" && process.env.AUTH_RATE_LIMIT !== "off"),
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
  // Ids come from Prisma (uuid(7)).
  advanced: { database: { generateId: false } },
  databaseHooks: {
    user: {
      create: {
        // Runs after the sign-up transaction commits. getCurrentSpace() repairs it if this fails.
        after: async (user) => {
          await ensurePersonalSpace(user.id);
        },
      },
    },
  },
  // Must be last: lets Server Actions set the session cookie.
  plugins: [nextCookies()],
});
