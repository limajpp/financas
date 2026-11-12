import "server-only";

import type { SyncResult } from "@/domain/outbox";
import type { ActionFailure } from "@/lib/action-result";
import { zodFailure } from "@/lib/action-result";
import { transactionFailure } from "@/lib/transaction-failure";
import type { SyncRequestItem } from "@/lib/validation/sync";
import { clientIdSchema, entrySchema, transferSchema } from "@/lib/validation/transactions";
import { createTransaction, createTransfer } from "@/server/transactions";

function rejected(clientId: string, failure: ActionFailure): SyncResult {
  return {
    clientId,
    status: "REJECTED",
    error: failure.error,
    ...(failure.fieldErrors ? { fieldErrors: failure.fieldErrors } : {}),
  };
}

async function syncItem(
  spaceId: string,
  userId: string,
  item: SyncRequestItem,
): Promise<SyncResult> {
  const clientId = clientIdSchema.safeParse(item.clientId);
  if (!clientId.success) return rejected(item.clientId, zodFailure(clientId.error));

  if (item.kind === "ENTRY") {
    const parsed = entrySchema.safeParse(item.data);
    if (!parsed.success) return rejected(item.clientId, zodFailure(parsed.error));
    const result = await createTransaction(spaceId, userId, clientId.data, parsed.data);
    if (!result.ok) return rejected(item.clientId, transactionFailure(result.error));
    return { clientId: item.clientId, status: "SYNCED", id: result.transaction.id };
  }
  if (item.kind === "TRANSFER") {
    const parsed = transferSchema.safeParse(item.data);
    if (!parsed.success) return rejected(item.clientId, zodFailure(parsed.error));
    const result = await createTransfer(spaceId, userId, clientId.data, parsed.data);
    if (!result.ok) return rejected(item.clientId, transactionFailure(result.error));
    return { clientId: item.clientId, status: "SYNCED", id: result.transaction.id };
  }
  return rejected(item.clientId, { ok: false, error: "Tipo de lançamento inválido." });
}

/**
 * Creates the entries registered offline, one by one and in order, through the same functions the
 * Server Actions use: the same rules, and the same idempotency by `clientId` (a batch sent twice
 * creates nothing new). The space and the user come from the session, never from the items, so
 * an account, card or category of another space simply isn't found.
 *
 * A bad item is REJECTED with its pt-BR message and doesn't stop the others. An unexpected
 * failure isn't the item's fault: it comes back as RETRY and stays pending on the device.
 */
export async function syncItems(
  spaceId: string,
  userId: string,
  items: readonly SyncRequestItem[],
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const item of items) {
    try {
      results.push(await syncItem(spaceId, userId, item));
    } catch (error) {
      console.error("sync: item failed", error);
      results.push({ clientId: item.clientId, status: "RETRY" });
    }
  }
  return results;
}
