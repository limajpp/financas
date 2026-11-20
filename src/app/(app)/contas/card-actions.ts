"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { CARD_ERROR_MESSAGES } from "@/domain/cards";
import { type ActionResult, zodFailure } from "@/lib/action-result";
import { cardIdSchema, cardSchema } from "@/lib/validation/cards";
import { type CardResult, createCard, setCardArchived, updateCard } from "@/server/cards";
import { getCurrentSpace } from "@/server/session";

const FIELD_OF_ERROR = {
  DUPLICATE_NAME: "name",
  ACCOUNT_NOT_FOUND: "accountId",
  ACCOUNT_ARCHIVED: "accountId",
} as const;

function done(result: CardResult): ActionResult {
  if (!result.ok) {
    const error = CARD_ERROR_MESSAGES[result.error];
    const field = result.error === "NOT_FOUND" ? undefined : FIELD_OF_ERROR[result.error];
    return { ok: false, error, fieldErrors: field ? { [field]: error } : undefined };
  }
  refresh();
  return { ok: true };
}

export async function createCardAction(input: unknown): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  return done(await createCard(space.id, parsed.data));
}

export async function updateCardAction(id: unknown, input: unknown): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = cardIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: CARD_ERROR_MESSAGES.NOT_FOUND };
  const parsed = cardSchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  return done(await updateCard(space.id, parsedId.data, parsed.data));
}

export async function setCardArchivedAction(id: unknown, archived: unknown): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = cardIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: CARD_ERROR_MESSAGES.NOT_FOUND };
  const parsedArchived = z.boolean().safeParse(archived);
  if (!parsedArchived.success) return { ok: false, error: "Dados inválidos." };
  return done(await setCardArchived(space.id, parsedId.data, parsedArchived.data));
}
