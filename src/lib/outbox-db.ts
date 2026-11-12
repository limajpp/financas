import Dexie, { liveQuery, type Table } from "dexie";

import type { OutboxChanges, OutboxItem } from "@/domain/outbox";

/**
 * The offline queue in IndexedDB (docs/specs/tasks/16-offline-queue.md). Browser only. Every
 * function may reject when IndexedDB isn't available (old private browsing, full storage): the
 * callers fall back to the "no connection" error.
 */
class OutboxDatabase extends Dexie {
  outbox!: Table<OutboxItem, string>;

  constructor() {
    super("financas");
    this.version(1).stores({ outbox: "clientId, userId" });
  }
}

let database: OutboxDatabase | null = null;
const db = () => (database ??= new OutboxDatabase());

const byAge = (a: OutboxItem, b: OutboxItem) => a.createdAt - b.createdAt;

/** Adds an entry to the queue. The same `clientId` again replaces it (a fixed item). */
export async function putInOutbox(item: OutboxItem): Promise<void> {
  await db().outbox.put(item);
}

/** The user's queue, oldest first. */
export async function listOutbox(userId: string): Promise<OutboxItem[]> {
  const items = await db().outbox.where("userId").equals(userId).toArray();
  return items.sort(byAge);
}

/** One item of the user's queue (never another user's). */
export async function findInOutbox(userId: string, clientId: string): Promise<OutboxItem | null> {
  const item = await db().outbox.get(clientId);
  return item && item.userId === userId ? item : null;
}

/** Removes an item. False when it was no longer there (already sent, or discarded elsewhere). */
export async function removeFromOutbox(clientId: string): Promise<boolean> {
  const { outbox } = db();
  return db().transaction("rw", outbox, async () => {
    if (!(await outbox.get(clientId))) return false;
    await outbox.delete(clientId);
    return true;
  });
}

/** Applies a batch's answer: the synced leave, the rejected keep the reason. */
export async function applyOutboxChanges(changes: OutboxChanges): Promise<void> {
  const { outbox } = db();
  await db().transaction("rw", outbox, async () => {
    await outbox.bulkDelete(changes.synced);
    for (const { clientId, error, fieldErrors } of changes.rejected) {
      // update() does nothing for an item discarded while the batch was on its way.
      await outbox.update(clientId, { status: "REJECTED", error, fieldErrors });
    }
  });
}

/** Deletes the user's whole queue (sign-out). */
export async function clearOutbox(userId: string): Promise<void> {
  await db().outbox.where("userId").equals(userId).delete();
}

/** Calls `onChange` with the user's queue now and on every change, in any tab. */
export function watchOutbox(userId: string, onChange: (items: OutboxItem[]) => void): () => void {
  const subscription = liveQuery(() => listOutbox(userId)).subscribe({
    next: onChange,
    // No IndexedDB: the queue is simply empty.
    error: () => onChange([]),
  });
  return () => subscription.unsubscribe();
}
