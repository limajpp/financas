import { describe, expect, it } from "vitest";

import {
  applyResults,
  nextBatch,
  type OutboxItem,
  outboxLabel,
  retryDelay,
  SYNC_BATCH_MAX,
  summarize,
  viewOf,
} from "./outbox";

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

describe("nextBatch", () => {
  it("envia os pendentes do usuário, do mais antigo para o mais novo", () => {
    const items = [item(3), item(1), item(2)];
    expect(nextBatch(items, "ana").map((i) => i.clientId)).toEqual(["id-1", "id-2", "id-3"]);
  });

  it("deixa de fora os itens de outro usuário e os rejeitados", () => {
    const items = [
      item(1, { userId: "bia" }),
      item(2, { status: "REJECTED", error: "x" }),
      item(3),
    ];
    expect(nextBatch(items, "ana").map((i) => i.clientId)).toEqual(["id-3"]);
  });

  it("limita o lote", () => {
    const items = Array.from({ length: SYNC_BATCH_MAX + 7 }, (_, n) => item(n));
    expect(nextBatch(items, "ana")).toHaveLength(SYNC_BATCH_MAX);
  });

  it("manda só o que o servidor precisa", () => {
    expect(nextBatch([item(1)], "ana")).toEqual([
      { clientId: "id-1", kind: "ENTRY", data: { amountCents: 1 } },
    ]);
  });
});

describe("applyResults", () => {
  it("tira os sincronizados, marca os rejeitados e mantém os que devem ser tentados de novo", () => {
    const batch = [item(1), item(2), item(3)];
    const changes = applyResults(batch, [
      { clientId: "id-1", status: "SYNCED", id: "tx-1" },
      {
        clientId: "id-2",
        status: "REJECTED",
        error: "A conta está arquivada.",
        fieldErrors: { accountId: "A conta está arquivada." },
      },
      { clientId: "id-3", status: "RETRY" },
    ]);
    expect(changes).toEqual({
      synced: ["id-1"],
      rejected: [
        {
          clientId: "id-2",
          error: "A conta está arquivada.",
          fieldErrors: { accountId: "A conta está arquivada." },
        },
      ],
      retry: ["id-3"],
    });
  });

  it("um item sem resposta continua pendente, e uma resposta sem item é ignorada", () => {
    const changes = applyResults([item(1)], [{ clientId: "outro", status: "SYNCED", id: "tx" }]);
    expect(changes).toEqual({ synced: [], rejected: [], retry: ["id-1"] });
  });
});

describe("retryDelay", () => {
  it("cresce a cada falha seguida e para em 5 minutos", () => {
    expect([1, 2, 3, 4, 5, 20].map(retryDelay)).toEqual([
      5_000, 15_000, 60_000, 300_000, 300_000, 300_000,
    ]);
  });

  it("volta ao início depois de um envio que deu certo (zero falhas)", () => {
    expect(retryDelay(0)).toBe(5_000);
  });
});

describe("summarize e outboxLabel", () => {
  it("conta só os itens do usuário", () => {
    const items = [
      item(1),
      item(2, { status: "REJECTED", error: "x" }),
      item(3, { userId: "bia" }),
    ];
    expect(summarize(items, "ana")).toEqual({ pending: 1, rejected: 1 });
  });

  it("descreve a fila", () => {
    expect(outboxLabel({ pending: 0, rejected: 0 }, false)).toBeNull();
    expect(outboxLabel({ pending: 1, rejected: 0 }, false)).toBe(
      "1 lançamento aguardando sincronização",
    );
    expect(outboxLabel({ pending: 3, rejected: 0 }, false)).toBe(
      "3 lançamentos aguardando sincronização",
    );
    expect(outboxLabel({ pending: 2, rejected: 1 }, false)).toBe("1 lançamento com erro");
    expect(outboxLabel({ pending: 0, rejected: 2 }, false)).toBe("2 lançamentos com erro");
  });

  it("com a sessão expirada, pede o login", () => {
    expect(outboxLabel({ pending: 2, rejected: 0 }, true)).toBe(
      "Entre de novo para enviar 2 lançamentos",
    );
    expect(outboxLabel({ pending: 1, rejected: 0 }, true)).toBe(
      "Entre de novo para enviar 1 lançamento",
    );
  });
});

describe("viewOf", () => {
  it("resume uma despesa, uma receita e uma transferência", () => {
    expect(
      viewOf({
        kind: "ENTRY",
        data: { type: "EXPENSE", amountCents: 4790, date: "2026-11-09", counterparty: " Padaria " },
      }),
    ).toEqual({ label: "Despesa", amountCents: 4790, date: "2026-11-09", what: "Padaria" });
    expect(
      viewOf({
        kind: "ENTRY",
        data: {
          type: "INCOME",
          amountCents: 100,
          date: "2026-11-09",
          counterparty: "",
          description: "Freela",
        },
      }),
    ).toMatchObject({ label: "Receita", what: "Freela" });
    expect(
      viewOf({
        kind: "TRANSFER",
        data: { amountCents: 5000, date: "2026-11-09", description: "" },
      }),
    ).toEqual({ label: "Transferência", amountCents: 5000, date: "2026-11-09", what: null });
  });

  it("não quebra com dados ilegíveis", () => {
    expect(viewOf({ kind: "ENTRY", data: null })).toEqual({
      label: "Despesa",
      amountCents: 0,
      date: null,
      what: null,
    });
    expect(viewOf({ kind: "ENTRY", data: { amountCents: "x", date: 5 } })).toMatchObject({
      amountCents: 0,
      date: null,
    });
  });
});
