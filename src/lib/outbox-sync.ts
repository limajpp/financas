import { applyResults, nextBatch, type OutboxItem, type SyncResult } from "@/domain/outbox";

import { applyOutboxChanges, listOutbox, markAttempted, removeFromOutbox } from "./outbox-db";

export type FlushOutcome = {
  /**
   * DONE: nothing left to send. FAILED: no network, no answer in time, a server error, or items
   * the server asked to retry (try again later). UNAUTHORIZED: the session expired, or it is
   * another user's. BUSY: another tab is sending.
   */
  status: "DONE" | "FAILED" | "UNAUTHORIZED" | "BUSY";
  synced: number;
  rejected: number;
};

const LOCK = "financas-outbox";

/**
 * A batch that doesn't answer in this long counts as failed (and is tried again later): on a
 * connection in name only the request would hang, and "Descartar" and "Sair" wait for it.
 */
export const SYNC_TIMEOUT_MS = 15_000;

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
      // From here on, these entries may reach the server whatever comes back.
      // Best effort: with the storage full the mark fails, and the batch must still go.
      await markAttempted(batch.map((item) => item.clientId)).catch(() => {});
      response = await fetch("/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The user the queue belongs to: the server refuses it under someone else's session.
        body: JSON.stringify({ userId, items: batch }),
        credentials: "same-origin",
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      });
    } catch {
      return { ...outcome, status: "FAILED" };
    }
    // 409: the session is another user's (signed in on this device after this one's expired).
    // Like a 401, the entries wait for their owner's login.
    if (response.status === 401 || response.status === 409) {
      return { ...outcome, status: "UNAUTHORIZED" };
    }
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
 * Waits for a send on its way, in this tab or another, to finish (at most `maxMs`). "Sair" uses it
 * so it doesn't ask about entries that are being sent right now.
 */
export async function waitForSend(maxMs = SYNC_TIMEOUT_MS): Promise<void> {
  const settled = (async () => {
    await current?.catch(() => {});
    if (typeof navigator !== "undefined" && navigator.locks) {
      await navigator.locks.request(LOCK, async () => {});
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    settled,
    new Promise<void>((resolve) => (timer = setTimeout(resolve, maxMs))),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Takes an entry out of the queue, for "Desfazer" and "Descartar". It waits for a send on its way
 * (in any tab) to finish first: an item already in a batch would be created on the server all the
 * same. Returns the removed entry, or null when it is no longer in the queue (it was sent).
 */
export async function discardFromOutbox(clientId: string): Promise<OutboxItem | null> {
  await current?.catch(() => {});
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(LOCK, async () => removeFromOutbox(clientId));
  }
  return removeFromOutbox(clientId);
}

/** What to tell the user after "Desfazer" or "Descartar", from what was actually removed. */
export function discardMessage(
  removed: OutboxItem | null,
  done: string,
): { kind: "ok" | "warning" | "error"; title: string; description?: string } {
  if (!removed) {
    return {
      kind: "error",
      title: "Este lançamento já foi enviado. Para apagar, exclua em Lançamentos.",
    };
  }
  if (removed.attempted) {
    // A request with it already left the device: nothing here can tell whether it arrived.
    return {
      kind: "warning",
      title: "Lançamento tirado deste aparelho.",
      description: "Se ele já tinha chegado ao servidor, exclua em Lançamentos.",
    };
  }
  return { kind: "ok", title: done };
}
