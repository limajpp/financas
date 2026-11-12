/**
 * The offline queue's rules. Pure functions only (no Dexie, no fetch).
 * Spec: docs/specs/tasks/16-offline-queue.md.
 */

/** What the register screen can queue: an expense or income, or a transfer. */
export const OUTBOX_KINDS = ["ENTRY", "TRANSFER"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export type FieldErrors = Partial<Record<string, string>>;

/** An entry saved on the device, waiting to be sent. */
export type OutboxItem = {
  /** The id the register screen gave the entry: resending it never duplicates. */
  clientId: string;
  /** Who registered it: only this user sees and sends it. */
  userId: string;
  kind: OutboxKind;
  /** What the form would have sent to the Server Action. */
  data: unknown;
  /** Epoch milliseconds: the queue is sent in this order. */
  createdAt: number;
  /** REJECTED: the server refused it; it waits to be fixed or discarded. */
  status: "PENDING" | "REJECTED";
  error?: string;
  fieldErrors?: FieldErrors;
};

/** One item as `/api/sync` receives it. */
export type SyncItem = Pick<OutboxItem, "clientId" | "kind" | "data">;

/** The server's answer for one item. RETRY: an unexpected failure, not the item's fault. */
export type SyncResult =
  | { clientId: string; status: "SYNCED"; id: string }
  | { clientId: string; status: "REJECTED"; error: string; fieldErrors?: FieldErrors }
  | { clientId: string; status: "RETRY" };

export const SYNC_BATCH_MAX = 50;

/** The user's pending items to send now, oldest first. */
export function nextBatch(items: readonly OutboxItem[], userId: string): SyncItem[] {
  return items
    .filter((item) => item.userId === userId && item.status === "PENDING")
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, SYNC_BATCH_MAX)
    .map(({ clientId, kind, data }) => ({ clientId, kind, data }));
}

export type OutboxChanges = {
  /** Leave the queue. */
  synced: string[];
  /** Stay, marked with the reason. */
  rejected: { clientId: string; error: string; fieldErrors?: FieldErrors }[];
  /** Stay pending. */
  retry: string[];
};

/** What a batch's answer changes in the queue. An item without an answer stays pending. */
export function applyResults(
  batch: readonly Pick<OutboxItem, "clientId">[],
  results: readonly SyncResult[],
): OutboxChanges {
  const byId = new Map(results.map((result) => [result.clientId, result]));
  const changes: OutboxChanges = { synced: [], rejected: [], retry: [] };
  for (const { clientId } of batch) {
    const result = byId.get(clientId);
    if (result?.status === "SYNCED") changes.synced.push(clientId);
    else if (result?.status === "REJECTED") {
      changes.rejected.push({
        clientId,
        error: result.error,
        ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
      });
    } else changes.retry.push(clientId);
  }
  return changes;
}

const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000];

/** How long to wait before trying again, after `failures` failed attempts in a row. */
export function retryDelay(failures: number): number {
  const index = Math.min(Math.max(failures, 1), RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[index];
}

export type OutboxSummary = { pending: number; rejected: number };

export function summarize(items: readonly OutboxItem[], userId: string): OutboxSummary {
  const summary = { pending: 0, rejected: 0 };
  for (const item of items) {
    if (item.userId !== userId) continue;
    if (item.status === "REJECTED") summary.rejected++;
    else summary.pending++;
  }
  return summary;
}

const entries = (n: number) => (n === 1 ? "1 lançamento" : `${n} lançamentos`);

/** The indicator's text, or null with an empty queue. Errors come first: they need the user. */
export function outboxLabel(summary: OutboxSummary, sessionExpired: boolean): string | null {
  if (summary.rejected > 0) return `${entries(summary.rejected)} com erro`;
  if (summary.pending === 0) return null;
  if (sessionExpired) return `Entre de novo para enviar ${entries(summary.pending)}`;
  return `${entries(summary.pending)} aguardando sincronização`;
}

/** What the queue's list shows of an item. The data is whatever the form saved: read with care. */
export type OutboxItemView = {
  label: "Despesa" | "Receita" | "Transferência";
  amountCents: number;
  /** A calendar date (YYYY-MM-DD), or null if the saved one is unreadable. */
  date: string | null;
  /** The counterparty, else the description. */
  what: string | null;
};

export function viewOf(item: Pick<OutboxItem, "kind" | "data">): OutboxItemView {
  const data = (typeof item.data === "object" && item.data !== null ? item.data : {}) as Record<
    string,
    unknown
  >;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  return {
    label:
      item.kind === "TRANSFER" ? "Transferência" : data.type === "INCOME" ? "Receita" : "Despesa",
    amountCents:
      typeof data.amountCents === "number" && Number.isFinite(data.amountCents)
        ? data.amountCents
        : 0,
    date: typeof data.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null,
    what: text(data.counterparty) ?? text(data.description),
  };
}
