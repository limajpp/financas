"use server";

import { refresh } from "next/cache";

import type { ActionResult } from "@/lib/action-result";
import { counterpartyIdSchema, memorySchema } from "@/lib/validation/counterparties";
import {
  COUNTERPARTY_ERROR_MESSAGES,
  mergeCounterparties,
  mergePreview,
  updateCounterparty,
} from "@/server/counterparties";
import { getCurrentSpace } from "@/server/session";

const notFound = { ok: false as const, error: COUNTERPARTY_ERROR_MESSAGES.NOT_FOUND };

/** Edits a counterparty's memory: name, aliases, CPF/CNPJ and the defaults. */
export async function updateCounterpartyAction(id: unknown, input: unknown): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = counterpartyIdSchema.safeParse(id);
  if (!parsedId.success) return notFound;
  const parsed = memorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const result = await updateCounterparty(space.id, parsedId.data, parsed.data);
  if (!result.ok) return { ok: false, error: COUNTERPARTY_ERROR_MESSAGES[result.error] };
  refresh();
  return { ok: true };
}

/** What merging would do, for the confirmation. */
export async function mergePreviewAction(keepId: unknown, absorbedId: unknown) {
  const space = await getCurrentSpace();
  const keep = counterpartyIdSchema.safeParse(keepId);
  const absorbed = counterpartyIdSchema.safeParse(absorbedId);
  if (!keep.success || !absorbed.success) return notFound;
  const preview = await mergePreview(space.id, keep.data, absorbed.data);
  if (!preview.ok) return { ok: false as const, error: COUNTERPARTY_ERROR_MESSAGES[preview.error] };
  return preview;
}

/** Merges `absorbedId` into `keepId` (no undo). */
export async function mergeCounterpartiesAction(
  keepId: unknown,
  absorbedId: unknown,
): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const keep = counterpartyIdSchema.safeParse(keepId);
  const absorbed = counterpartyIdSchema.safeParse(absorbedId);
  if (!keep.success || !absorbed.success) return notFound;
  const result = await mergeCounterparties(space.id, keep.data, absorbed.data);
  if (!result.ok) return { ok: false, error: COUNTERPARTY_ERROR_MESSAGES[result.error] };
  refresh();
  return { ok: true };
}
