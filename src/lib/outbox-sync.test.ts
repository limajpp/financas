import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OutboxItem, SyncItem, SyncResult } from "@/domain/outbox";

import { clearOutbox, listOutbox, putInOutbox } from "./outbox-db";
import { flushOutbox } from "./outbox-sync";

function item(n: number, over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    clientId: `id-${n}`,
    userId: "ana",
    kind: "ENTRY",
    data: { amountCents: n },
    createdAt: n,
    status: "PENDING",
    ...over,
  };
}

/** A fake `/api/sync`: answers each batch with `answer`, and records what was sent. */
function server(answer: (item: SyncItem) => SyncResult["status"] = () => "SYNCED") {
  const batches: SyncItem[][] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const { items } = JSON.parse(init.body as string) as { items: SyncItem[] };
    batches.push(items);
    const results = items.map((i): SyncResult => {
      const status = answer(i);
      if (status === "SYNCED") return { clientId: i.clientId, status, id: `tx-${i.clientId}` };
      if (status === "REJECTED") return { clientId: i.clientId, status, error: "Data inválida." };
      return { clientId: i.clientId, status };
    });
    return Response.json({ results });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { batches, fetchMock };
}

beforeEach(async () => {
  await Promise.all([clearOutbox("ana"), clearOutbox("bia")]);
});
afterEach(() => vi.unstubAllGlobals());

describe("flushOutbox", () => {
  it("sem nada pendente, não chama o servidor", async () => {
    const { fetchMock } = server();
    await putInOutbox(item(1, { status: "REJECTED", error: "x" }));
    expect(await flushOutbox("ana")).toEqual({ status: "DONE", synced: 0, rejected: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envia os pendentes do usuário em ordem e esvazia a fila", async () => {
    const { batches, fetchMock } = server();
    await putInOutbox(item(2));
    await putInOutbox(item(1));
    await putInOutbox(item(3, { userId: "bia" }));

    expect(await flushOutbox("ana")).toEqual({ status: "DONE", synced: 2, rejected: 0 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sync",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(batches).toEqual([
      [
        { clientId: "id-1", kind: "ENTRY", data: { amountCents: 1 } },
        { clientId: "id-2", kind: "ENTRY", data: { amountCents: 2 } },
      ],
    ]);
    expect(await listOutbox("ana")).toEqual([]);
    expect(await listOutbox("bia")).toHaveLength(1);
  });

  it("manda em lotes de 50 até acabar", async () => {
    const { batches } = server();
    for (let n = 1; n <= 120; n++) await putInOutbox(item(n));
    expect(await flushOutbox("ana")).toEqual({ status: "DONE", synced: 120, rejected: 0 });
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
  });

  it("um rejeitado fica na fila com o motivo e não trava os outros", async () => {
    server((i) => (i.clientId === "id-2" ? "REJECTED" : "SYNCED"));
    for (const n of [1, 2, 3]) await putInOutbox(item(n));

    expect(await flushOutbox("ana")).toEqual({ status: "DONE", synced: 2, rejected: 1 });
    expect(await listOutbox("ana")).toEqual([
      item(2, { status: "REJECTED", error: "Data inválida.", fieldErrors: undefined }),
    ]);
  });

  it("um item que o servidor pede para tentar de novo continua pendente, sem laço", async () => {
    const { fetchMock } = server((i) => (i.clientId === "id-1" ? "RETRY" : "SYNCED"));
    await putInOutbox(item(1));
    await putInOutbox(item(2));

    expect(await flushOutbox("ana")).toEqual({ status: "FAILED", synced: 1, rejected: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await listOutbox("ana")).toEqual([item(1)]);
  });

  it("sem rede, tudo continua pendente", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await putInOutbox(item(1));
    expect(await flushOutbox("ana")).toEqual({ status: "FAILED", synced: 0, rejected: 0 });
    expect(await listOutbox("ana")).toEqual([item(1)]);
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [500, "FAILED"],
    [403, "FAILED"],
  ])("com resposta %i, tudo continua pendente (%s)", async (status, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "x" }, { status })),
    );
    await putInOutbox(item(1));
    expect(await flushOutbox("ana")).toEqual({ status: expected, synced: 0, rejected: 0 });
    expect(await listOutbox("ana")).toEqual([item(1)]);
  });

  it("uma resposta que não é a do sync (a página de login, por exemplo) não mexe na fila", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } })),
    );
    await putInOutbox(item(1));
    expect((await flushOutbox("ana")).status).toBe("FAILED");
    expect(await listOutbox("ana")).toEqual([item(1)]);
  });

  it("dois envios ao mesmo tempo: só um vai ao servidor", async () => {
    const { fetchMock } = server();
    await putInOutbox(item(1));
    const [a, b] = await Promise.all([flushOutbox("ana"), flushOutbox("ana")]);
    expect([a.status, b.status].sort()).toEqual(["BUSY", "DONE"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
