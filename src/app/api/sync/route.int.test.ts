import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { accountSchema } from "@/lib/validation/accounts";
import { createAccount } from "@/server/accounts";
import { ensurePersonalSpace } from "@/server/spaces";
import { resetDatabase } from "@/test/db";

// The session comes from the request's cookies, which only exist inside Next.
const session = vi.hoisted(() => ({
  current: null as null | { userId: string; spaceId: string },
}));
vi.mock("@/server/session", () => ({
  getSession: async () => (session.current ? { user: { id: session.current.userId } } : null),
  getCurrentSpace: async () => ({ id: session.current!.spaceId }),
}));

const { POST } = await import("./route");

beforeEach(async () => {
  await resetDatabase();
  session.current = null;
});
afterAll(() => db.$disconnect());

async function signedIn() {
  const row = await db.user.create({ data: { name: "Ana Teste", email: "ana@example.com" } });
  const space = await ensurePersonalSpace(row.id);
  const created = await createAccount(
    space.id,
    accountSchema.parse({
      name: "Banco Azul",
      color: "blue",
      initialBalance: "1.000,00",
      initialBalanceDate: "2026-10-01",
    }),
  );
  if (!created.ok) throw new Error(created.error);
  session.current = { userId: row.id, spaceId: space.id };
  return { spaceId: space.id, accountId: created.account.id };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost:3000/api/sync", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        origin: "http://localhost:3000",
        "content-type": "application/json",
        ...headers,
      },
      body:
        typeof body === "string"
          ? body
          : JSON.stringify({ userId: session.current?.userId ?? "ninguém", ...(body as object) }),
    }),
  );
}

const item = (accountId: string) => ({
  clientId: randomUUID(),
  kind: "ENTRY",
  data: {
    type: "EXPENSE",
    amountCents: 4790,
    date: "2026-10-15",
    method: "PIX",
    accountId,
  },
});

describe("POST /api/sync", () => {
  it("cria os lançamentos do espaço da sessão e responde item a item", async () => {
    const { spaceId, accountId } = await signedIn();
    const items = [item(accountId), item("00000000-0000-4000-8000-000000000000")];

    const response = await post({ items });

    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results).toEqual([
      { clientId: items[0].clientId, status: "SYNCED", id: expect.any(String) },
      expect.objectContaining({ clientId: items[1].clientId, status: "REJECTED" }),
    ]);
    expect(await db.transaction.count({ where: { spaceId } })).toBe(1);
  });

  it("ignora um spaceId mandado no corpo", async () => {
    const { spaceId, accountId } = await signedIn();
    const other = await db.user.create({ data: { name: "Bia Teste", email: "bia@example.com" } });
    const otherSpace = await ensurePersonalSpace(other.id);

    const response = await post({
      spaceId: otherSpace.id,
      items: [{ ...item(accountId), spaceId: otherSpace.id }],
    });

    expect(response.status).toBe(200);
    expect(await db.transaction.count({ where: { spaceId } })).toBe(1);
    expect(await db.transaction.count({ where: { spaceId: otherSpace.id } })).toBe(0);
  });

  it("recusa a fila de outro usuário com 409, sem criar nada", async () => {
    const { spaceId, accountId } = await signedIn();
    const response = await post({ userId: "outra-pessoa", items: [item(accountId)] });
    expect(response.status).toBe(409);
    expect(await db.transaction.count({ where: { spaceId } })).toBe(0);
    // And without saying whose queue it is, nothing is accepted.
    expect((await post({ userId: undefined, items: [item(accountId)] })).status).toBe(400);
  });

  it("sem sessão responde 401 em JSON (CA5)", async () => {
    const response = await post({ items: [item(randomUUID())] });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sessão expirada. Entre de novo." });
  });

  it("de outra origem, ou sem origem, responde 403 (CA5)", async () => {
    const { spaceId, accountId } = await signedIn();
    const body = { items: [item(accountId)] };
    expect((await post(body, { origin: "https://outro.example" })).status).toBe(403);
    expect((await post(body, { origin: "" })).status).toBe(403);
    expect((await post(body, { origin: "null" })).status).toBe(403);
    expect(await db.transaction.count({ where: { spaceId } })).toBe(0);
  });

  it("aceita a origem do host público atrás do proxy", async () => {
    const { accountId } = await signedIn();
    const response = await post(
      { items: [item(accountId)] },
      { origin: "https://financas.example", "x-forwarded-host": "financas.example" },
    );
    expect(response.status).toBe(200);
  });

  it("corpo malformado, vazio, grande demais ou que não é JSON responde 400 (CA5)", async () => {
    const { spaceId, accountId } = await signedIn();
    expect((await post("{ não é json")).status).toBe(400);
    expect((await post({ items: [] })).status).toBe(400);
    expect((await post({ items: "x" })).status).toBe(400);
    expect((await post({ items: [{ kind: "ENTRY", data: {} }] })).status).toBe(400);
    expect((await post({ items: Array.from({ length: 51 }, () => item(accountId)) })).status).toBe(
      400,
    );
    expect(
      (await post({ items: [item(accountId)] }, { "content-type": "text/plain" })).status,
    ).toBe(400);
    expect(await db.transaction.count({ where: { spaceId } })).toBe(0);
  });
});
