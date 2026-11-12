import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OutboxItem, SyncItem } from "@/domain/outbox";

import { clearOutbox, listOutbox, putInOutbox } from "./outbox-db";
import { OutboxEngine } from "./outbox-engine";
import * as sync from "./outbox-sync";

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

/** A fake `/api/sync` whose answer can change during the test. */
function server() {
  const api = {
    status: 200,
    calls: 0,
    hold: null as Promise<void> | null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      api.calls++;
      if (api.hold) await api.hold;
      if (api.status !== 200) return Response.json({ error: "x" }, { status: api.status });
      const { items } = JSON.parse(init.body as string) as { items: SyncItem[] };
      return Response.json({
        results: items.map((i) => ({ clientId: i.clientId, status: "SYNCED", id: "tx" })),
      });
    }),
  );
  return api;
}

const queue = () => listOutbox("ana");
let stop: (() => void) | null = null;
let running: OutboxEngine | null = null;
function start(engine: OutboxEngine, onSynced: (count: number) => void = () => {}) {
  running = engine;
  stop = engine.start(onSynced);
}

beforeEach(async () => {
  await Promise.all([clearOutbox("ana"), clearOutbox("bia")]);
});
afterEach(async () => {
  stop?.();
  stop = null;
  // A send still on its way would reach the next test's fake server. Stopped, nothing new starts.
  const engine = running;
  running = null;
  if (engine) await vi.waitFor(() => expect(engine.getState().sending).toBe(false));
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("OutboxEngine", () => {
  it("ao abrir o app, envia a fila que encontrou e avisa quantos foram", async () => {
    const api = server();
    await putInOutbox(item(1));
    await putInOutbox(item(2));
    const synced = vi.fn();
    const engine = new OutboxEngine();

    start(engine, synced);
    engine.signedIn("ana");

    await vi.waitFor(() => expect(synced).toHaveBeenCalledWith(2));
    expect(api.calls).toBe(1);
    expect(await queue()).toEqual([]);
    await vi.waitFor(() =>
      expect(engine.getState()).toMatchObject({ userId: "ana", items: [], sending: false }),
    );
  });

  it("envia um lançamento que entra na fila com o app aberto", async () => {
    const api = server();
    const engine = new OutboxEngine();
    start(engine);
    engine.signedIn("ana");
    await vi.waitFor(() => expect(engine.getState().userId).toBe("ana"));
    expect(api.calls).toBe(0);

    await putInOutbox(item(1));

    await vi.waitFor(async () => expect(await queue()).toEqual([]));
    expect(api.calls).toBe(1);
  });

  it("não mostra nem envia a fila de outro usuário", async () => {
    const api = server();
    await putInOutbox(item(1, { userId: "bia" }));
    const engine = new OutboxEngine();
    start(engine);
    engine.signedIn("ana");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.getState().items).toEqual([]);
    expect(api.calls).toBe(0);
    expect(await listOutbox("bia")).toHaveLength(1);
  });

  it("um lançamento que entra logo depois da última olhada do envio não fica para trás", async () => {
    const api = server();
    await putInOutbox(item(1));
    // Item 2 arrives right after the send has looked at the queue for the last time (when it is
    // about to answer DONE): its own request to send is absorbed by the send still running.
    const real = sync.flushOutbox;
    let first = true;
    vi.spyOn(sync, "flushOutbox").mockImplementation(async (userId) => {
      const outcome = await real(userId);
      if (first) {
        first = false;
        await putInOutbox(item(2));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return outcome;
    });
    const engine = new OutboxEngine();
    start(engine);
    engine.signedIn("ana");

    await vi.waitFor(async () => expect(await queue()).toEqual([]));
    expect(api.calls).toBe(2);
  });

  it("depois de uma falha, tenta de novo com espera crescente, e volta ao início ao conseguir (CA6)", async () => {
    const api = server();
    api.status = 500;
    await putInOutbox(item(1));
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    // Records the engine's retry waits and runs them at once.
    vi.stubGlobal("setTimeout", (fn: () => void, ms = 0) => {
      if (![5_000, 15_000, 60_000, 300_000].includes(ms)) return realSetTimeout(fn, ms);
      delays.push(ms);
      return realSetTimeout(fn, 0);
    });
    const engine = new OutboxEngine();
    start(engine);
    engine.signedIn("ana");

    await vi.waitFor(() => expect(delays.length).toBeGreaterThanOrEqual(5));
    expect(delays.slice(0, 5)).toEqual([5_000, 15_000, 60_000, 300_000, 300_000]);
    expect(await queue()).toEqual([item(1, { attempted: true })]);

    api.status = 200;
    await vi.waitFor(async () => expect(await queue()).toEqual([]));
    const before = delays.length;
    api.status = 500;
    await putInOutbox(item(2));
    await vi.waitFor(() => expect(delays.length).toBeGreaterThan(before));
    expect(delays[before]).toBe(5_000);
  });

  it("com a sessão expirada, espera o novo login e então envia sozinho", async () => {
    const api = server();
    api.status = 401;
    await putInOutbox(item(1));
    const synced = vi.fn();
    const engine = new OutboxEngine();
    start(engine, synced);
    engine.signedIn("ana");

    await vi.waitFor(() => expect(engine.getState().sessionExpired).toBe(true));
    // No retry without a new session.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.calls).toBe(1);

    // The login screen hides the app's layout; signing in shows it again, with the same user.
    stop?.();
    api.status = 200;
    start(engine, synced);
    engine.signedIn("ana");

    await vi.waitFor(() => expect(synced).toHaveBeenCalledWith(1));
    expect(engine.getState().sessionExpired).toBe(false);
    expect(await queue()).toEqual([]);
  });

  it("whenUser responde com o usuário atual, mesmo depois de trocar de conta", async () => {
    server();
    const engine = new OutboxEngine();
    start(engine);
    const waiting = engine.whenUser();
    expect(engine.userId()).toBeNull();
    engine.signedIn("ana");
    expect(await waiting).toBe("ana");
    expect(await engine.whenUser()).toBe("ana");

    engine.signedIn("bia");
    expect(await engine.whenUser()).toBe("bia");
    expect(engine.userId()).toBe("bia");
  });

  it("chamadas de envio simultâneas recebem o mesmo resultado, com um pedido só", async () => {
    const api = server();
    const engine = new OutboxEngine();
    start(engine);
    engine.signedIn("ana");
    await vi.waitFor(() => expect(engine.getState().userId).toBe("ana"));
    let release: () => void = () => {};
    api.hold = new Promise((resolve) => (release = resolve));
    await putInOutbox(item(1));
    await vi.waitFor(() => expect(api.calls).toBe(1));

    // "Sair" asks for a send while one is running: it waits for that one.
    const asked = engine.flush();
    api.hold = null;
    release();

    expect(await asked).toMatchObject({ status: "DONE", synced: 1 });
    expect(api.calls).toBe(1);
  });

  it("sem usuário, não envia", async () => {
    const api = server();
    await putInOutbox(item(1));
    const engine = new OutboxEngine();
    start(engine);
    expect(await engine.flush()).toBeNull();
    expect(api.calls).toBe(0);
  });
});
