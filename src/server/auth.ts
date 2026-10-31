import "server-only";

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/lib/db";
import { signUpSchema } from "@/lib/validation/auth";
import { ensurePersonalSpace } from "@/server/spaces";

// Better Auth only checks that name is a string; the endpoint can be called without our form.
function validName(name: unknown) {
  const parsed = signUpSchema.shape.name.safeParse(name);
  if (!parsed.success)
    throw new APIError("BAD_REQUEST", { message: parsed.error.issues[0].message });
  return parsed.data;
}

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
        before: async (user) => ({ data: { ...user, name: validName(user.name) } }),
        // Runs after the sign-up transaction commits, so the account already exists: a failure here
        // must not fail the sign-up. getCurrentSpace() creates the space later.
        after: async (user) => {
          try {
            await ensurePersonalSpace(user.id);
          } catch (error) {
            console.error("ensurePersonalSpace failed after sign-up", error);
          }
        },
      },
      update: {
        before: async (user) =>
          user.name === undefined ? undefined : { data: { ...user, name: validName(user.name) } },
      },
    },
  },
  // Must be last: lets Server Actions set the session cookie.
  plugins: [nextCookies()],
});
