import { applyResults, nextBatch, type SyncResult } from "@/domain/outbox";

import { applyOutboxChanges, listOutbox, removeFromOutbox } from "./outbox-db";

export type FlushOutcome = {
  /**
   * DONE: nothing left to send. FAILED: no network, a server error, or items the server asked to
   * retry (try again later). UNAUTHORIZED: the session expired. BUSY: another tab is sending.
   */
  status: "DONE" | "FAILED" | "UNAUTHORIZED" | "BUSY";
  synced: number;
  rejected: number;
};

const LOCK = "financas-outbox";

function isResults(body: unknown): body is { results: SyncResult[] } {
  return (
    typeof body === "object" &&
    body !== null &&
    Array.isArray((body as { results?: unknown }).results)
  );
}

async function send(userId: string): Promise<FlushOutcome> {
  const outcome: FlushOutcome = { status: "DONE", synced: 0, rejected: 0 };
  for (;;) {
    const batch = nextBatch(await listOutbox(userId), userId);
    if (batch.length === 0) return outcome;

    let response: Response;
    try {
      response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: batch }),
        credentials: "same-origin",
      });
    } catch {
      return { ...outcome, status: "FAILED" };
    }
    if (response.status === 401) return { ...outcome, status: "UNAUTHORIZED" };
    if (!response.ok) return { ...outcome, status: "FAILED" };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ...outcome, status: "FAILED" };
    }
    if (!isResults(body)) return { ...outcome, status: "FAILED" };

    const changes = applyResults(batch, body.results);
    await applyOutboxChanges(changes);
    outcome.synced += changes.synced.length;
    outcome.rejected += changes.rejected.length;
    // Something stayed pending: stop here, or the same items would be sent in a loop.
    if (changes.retry.length > 0) return { ...outcome, status: "FAILED" };
  }
}

/** The send running in this tab, if any. */
let current: Promise<FlushOutcome> | null = null;

/**
 * Sends the user's pending entries to `/api/sync`, in batches, and updates the queue with the
 * answers. Only one tab sends at a time (not needed for correctness, the server dedupes by
 * `clientId`; it just avoids double work): BUSY when another one is at it.
 */
export async function flushOutbox(userId: string): Promise<FlushOutcome> {
  const busy: FlushOutcome = { status: "BUSY", synced: 0, rejected: 0 };
  if (current) return busy;
  // One tab at a time. Without the Web Locks API (old browsers), each tab sends on its own.
  const run = (async (): Promise<FlushOutcome> => {
    if (typeof navigator === "undefined" || !navigator.locks) return send(userId);
    return await navigator.locks.request(LOCK, { ifAvailable: true }, async (lock) =>
      lock ? send(userId) : busy,
    );
  })();
  current = run;
  try {
    return await run;
  } finally {
    current = null;
  }
}

/**
 * Takes an entry out of the queue, for "Desfazer" and "Descartar". It waits for a send on its way
 * (in any tab) to finish first: an item already in a batch would be created on the server all the
 * same. False when the entry is no longer in the queue, which means it was sent.
 */
export async function discardFromOutbox(clientId: string): Promise<boolean> {
  await current?.catch(() => {});
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(LOCK, async () => removeFromOutbox(clientId));
  }
  return removeFromOutbox(clientId);
}
