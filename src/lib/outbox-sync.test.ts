import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OutboxItem, SyncItem, SyncResult } from "@/domain/outbox";

import { clearOutbox, listOutbox, putInOutbox } from "./outbox-db";
import { discardFromOutbox, flushOutbox, waitForSend } from "./outbox-sync";

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

  it("diz ao servidor de quem é a fila e desiste de um envio que não responde", async () => {
    const { fetchMock } = server();
    await putInOutbox(item(1));
    await flushOutbox("ana");
    const init = fetchMock.mock.calls[0]![1];
    expect(JSON.parse(init.body as string)).toMatchObject({ userId: "ana" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("um envio sem resposta a tempo conta como falha, e o item fica marcado como tentado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    await putInOutbox(item(1));
    expect((await flushOutbox("ana")).status).toBe("FAILED");
    expect(await listOutbox("ana")).toEqual([item(1, { attempted: true })]);
  });

  it("a fila de outro usuário (409) espera o login do dono, sem marcar nada como recusado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "x" }, { status: 409 })),
    );
    await putInOutbox(item(1));
    expect((await flushOutbox("ana")).status).toBe("UNAUTHORIZED");
    expect(await listOutbox("ana")).toEqual([item(1, { attempted: true })]);
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
      item(2, {
        status: "REJECTED",
        error: "Data inválida.",
        fieldErrors: undefined,
        attempted: true,
      }),
    ]);
  });

  it("um item que o servidor pede para tentar de novo continua pendente, sem laço", async () => {
    const { fetchMock } = server((i) => (i.clientId === "id-1" ? "RETRY" : "SYNCED"));
    await putInOutbox(item(1));
    await putInOutbox(item(2));

    expect(await flushOutbox("ana")).toEqual({ status: "FAILED", synced: 1, rejected: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await listOutbox("ana")).toEqual([item(1, { attempted: true })]);
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
    expect(await listOutbox("ana")).toEqual([item(1, { attempted: true })]);
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
    expect(await listOutbox("ana")).toEqual([item(1, { attempted: true })]);
  });

  it("uma resposta que não é a do sync (a página de login, por exemplo) não mexe na fila", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } })),
    );
    await putInOutbox(item(1));
    expect((await flushOutbox("ana")).status).toBe("FAILED");
    expect(await listOutbox("ana")).toEqual([item(1, { attempted: true })]);
  });

  it("dois envios ao mesmo tempo: só um vai ao servidor", async () => {
    const { fetchMock } = server();
    await putInOutbox(item(1));
    const [a, b] = await Promise.all([flushOutbox("ana"), flushOutbox("ana")]);
    expect([a.status, b.status].sort()).toEqual(["BUSY", "DONE"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("discardFromOutbox", () => {
  it("tira da fila um item que ainda não foi enviado", async () => {
    const { fetchMock } = server();
    await putInOutbox(item(1));
    expect(await discardFromOutbox("id-1")).toBe(true);
    expect(await listOutbox("ana")).toEqual([]);
    await flushOutbox("ana");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("espera o envio em curso e avisa que o item já foi enviado", async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    await putInOutbox(item(1));
    const flushing = flushOutbox("ana");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    // "Descartar" tapped while the batch is on its way.
    let discarded: boolean | null = null;
    const discarding = discardFromOutbox("id-1").then((removed) => (discarded = removed));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(discarded).toBeNull();

    answer(Response.json({ results: [{ clientId: "id-1", status: "SYNCED", id: "tx-1" }] }));
    await flushing;
    await discarding;
    expect(discarded).toBe(false);
  });
});

/**
 * A small Web Locks API (jsdom has none): exclusive locks by name, `ifAvailable`, and `hold()` to
 * play another tab that holds the queue's lock until `release()`.
 */
function fakeLocks() {
  const held = new Map<string, Promise<void>>();
  const request = async (
    name: string,
    optionsOrCallback: unknown,
    maybeCallback?: (lock: unknown) => Promise<unknown>,
  ) => {
    const callback = (maybeCallback ?? optionsOrCallback) as (lock: unknown) => Promise<unknown>;
    const ifAvailable =
      typeof optionsOrCallback === "object" &&
      (optionsOrCallback as { ifAvailable?: boolean }).ifAvailable;
    if (held.has(name) && ifAvailable) return callback(null);
    while (held.has(name)) await held.get(name);
    let done: () => void = () => {};
    held.set(name, new Promise<void>((resolve) => (done = resolve)));
    try {
      return await callback({ name });
    } finally {
      held.delete(name);
      done();
    }
  };
  vi.stubGlobal("navigator", { ...navigator, locks: { request } });
  return {
    /** Another tab takes the lock. */
    hold(name = "financas-outbox") {
      let release: () => void = () => {};
      const released = new Promise<void>((resolve) => (release = resolve));
      void request(name, () => released);
      return release;
    },
  };
}

describe("com outra aba enviando (Web Locks)", () => {
  it("o envio desta aba responde BUSY e não chama o servidor", async () => {
    const locks = fakeLocks();
    const { fetchMock } = server();
    await putInOutbox(item(1));
    const release = locks.hold();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await flushOutbox("ana")).status).toBe("BUSY");
    expect(fetchMock).not.toHaveBeenCalled();

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await flushOutbox("ana")).status).toBe("DONE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("descartar espera a outra aba terminar o envio", async () => {
    const locks = fakeLocks();
    await putInOutbox(item(1));
    const release = locks.hold();
    await new Promise((resolve) => setTimeout(resolve, 0));

    let discarded: boolean | null = null;
    const discarding = discardFromOutbox("id-1").then((removed) => (discarded = removed));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(discarded).toBeNull();

    // The other tab's batch took it.
    await clearOutbox("ana");
    release();
    await discarding;
    expect(discarded).toBe(false);
  });

  it("esperar o envio termina quando a outra aba solta a fila, ou no limite", async () => {
    const locks = fakeLocks();
    const release = locks.hold();
    await new Promise((resolve) => setTimeout(resolve, 0));

    let waited = false;
    const waiting = waitForSend(10_000).then(() => (waited = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(waited).toBe(false);
    release();
    await waiting;
    expect(waited).toBe(true);

    locks.hold();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const started = Date.now();
    await waitForSend(50);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
