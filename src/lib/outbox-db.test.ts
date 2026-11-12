import "fake-indexeddb/auto";

import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";

import type { OutboxItem } from "@/domain/outbox";

import {
  applyOutboxChanges,
  clearOutbox,
  findInOutbox,
  listOutbox,
  putInOutbox,
  removeFromOutbox,
  watchOutbox,
} from "./outbox-db";

function item(n: number, over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    clientId: `id-${n}`,
    userId: "ana",
    kind: "ENTRY",
    data: { type: "EXPENSE", amountCents: n * 100 },
    createdAt: n,
    status: "PENDING",
    ...over,
  };
}

beforeEach(async () => {
  await Promise.all([clearOutbox("ana"), clearOutbox("bia")]);
});

describe("fila no IndexedDB", () => {
  it("guarda e lista os itens do usuário, do mais antigo para o mais novo", async () => {
    await putInOutbox(item(2));
    await putInOutbox(item(1));
    await putInOutbox(item(3, { userId: "bia" }));

    expect((await listOutbox("ana")).map((i) => i.clientId)).toEqual(["id-1", "id-2"]);
    expect(await listOutbox("bia")).toEqual([item(3, { userId: "bia" })]);
    expect(await listOutbox("caio")).toEqual([]);
  });

  it("fica guardada entre aberturas do app", async () => {
    await putInOutbox(item(1));
    // What another tab, or the next opening, reads.
    const other = new Dexie("financas");
    await other.open();
    expect(await other.table("outbox").toArray()).toEqual([item(1)]);
    other.close();
  });

  it("busca um item só na fila do próprio usuário", async () => {
    await putInOutbox(item(1));
    expect(await findInOutbox("ana", "id-1")).toEqual(item(1));
    expect(await findInOutbox("bia", "id-1")).toBeNull();
    expect(await findInOutbox("ana", "id-9")).toBeNull();
  });

  it("descarta um item", async () => {
    await putInOutbox(item(1));
    await putInOutbox(item(2));
    await removeFromOutbox("id-1");
    expect((await listOutbox("ana")).map((i) => i.clientId)).toEqual(["id-2"]);
  });

  it("corrigir substitui o item rejeitado pelo mesmo clientId, de novo pendente", async () => {
    await putInOutbox(item(1, { status: "REJECTED", error: "A conta está arquivada." }));
    await putInOutbox(item(1, { data: { type: "EXPENSE", amountCents: 999 } }));
    expect(await listOutbox("ana")).toEqual([
      item(1, { data: { type: "EXPENSE", amountCents: 999 } }),
    ]);
  });

  it("aplica a resposta do servidor", async () => {
    await putInOutbox(item(1));
    await putInOutbox(item(2));
    await putInOutbox(item(3));

    await applyOutboxChanges({
      synced: ["id-1"],
      rejected: [
        { clientId: "id-2", error: "Data inválida.", fieldErrors: { date: "Data inválida." } },
        { clientId: "já-descartado", error: "x" },
      ],
      retry: ["id-3"],
    });

    expect(await listOutbox("ana")).toEqual([
      item(2, {
        status: "REJECTED",
        error: "Data inválida.",
        fieldErrors: { date: "Data inválida." },
      }),
      item(3),
    ]);
  });

  it("sair apaga só a fila do usuário", async () => {
    await putInOutbox(item(1));
    await putInOutbox(item(2, { userId: "bia" }));
    await clearOutbox("ana");
    expect(await listOutbox("ana")).toEqual([]);
    expect(await listOutbox("bia")).toHaveLength(1);
  });

  it("avisa a cada mudança na fila do usuário", async () => {
    const seen: number[] = [];
    const stop = watchOutbox("ana", (items) => seen.push(items.length));
    await expect.poll(() => seen).toEqual([0]);
    await putInOutbox(item(1));
    await expect.poll(() => seen.at(-1)).toBe(1);
    await removeFromOutbox("id-1");
    await expect.poll(() => seen.at(-1)).toBe(0);
    stop();
    const calls = seen.length;
    await putInOutbox(item(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).toHaveLength(calls);
  });
});
