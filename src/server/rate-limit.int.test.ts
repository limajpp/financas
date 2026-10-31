import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { resetDatabase } from "@/test/db";

// Off outside production by default; this file turns it on before loading the auth module.
let auth: typeof import("@/server/auth").auth;
beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT = "on";
  ({ auth } = await import("@/server/auth"));
});
beforeEach(resetDatabase);
afterAll(async () => {
  delete process.env.AUTH_RATE_LIMIT;
  await db.$disconnect();
});

function signInRequest(ip: string) {
  return new Request("http://localhost:3000/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ email: "ana@example.com", password: "senha-errada" }),
  });
}

describe("rate limit do login", () => {
  it("bloqueia a 6ª tentativa no mesmo minuto, por IP, guardando no Postgres", async () => {
    const statuses = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await auth.handler(signInRequest("203.0.113.7"))).status);

    expect(statuses.slice(0, 5).every((status) => status === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
    expect(await db.rateLimit.count()).toBeGreaterThan(0);

    // Another IP still gets through.
    expect((await auth.handler(signInRequest("203.0.113.8"))).status).toBe(401);
  });
});
