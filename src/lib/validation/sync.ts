import { z } from "zod";

import { SYNC_BATCH_MAX } from "@/domain/outbox";

/**
 * The envelope of `/api/sync`. Each item is checked on its own afterwards (its kind, clientId and
 * data), so one bad item is rejected without failing the batch; here it only needs an id to
 * answer by.
 */
export const syncRequestSchema = z.object({
  items: z
    .array(
      z.object({
        clientId: z.string().min(1).max(100),
        kind: z.unknown(),
        data: z.unknown(),
      }),
    )
    .min(1)
    .max(SYNC_BATCH_MAX),
});

export type SyncRequestItem = z.infer<typeof syncRequestSchema>["items"][number];
