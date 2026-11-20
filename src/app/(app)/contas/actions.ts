"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { ACCOUNT_ERROR_MESSAGES } from "@/domain/accounts";
import { type ActionResult, zodFailure } from "@/lib/action-result";
import { accountIdSchema, accountSchema } from "@/lib/validation/accounts";
import {
  type AccountResult,
  createAccount,
  setAccountArchived,
  updateAccount,
} from "@/server/accounts";
import { getCurrentSpace } from "@/server/session";

const FIELD_OF_ERROR = { DUPLICATE_NAME: "name", FUTURE_DATE: "initialBalanceDate" } as const;

function done(result: AccountResult): ActionResult {
  if (!result.ok) {
    const error = ACCOUNT_ERROR_MESSAGES[result.error];
    const field = result.error === "NOT_FOUND" ? undefined : FIELD_OF_ERROR[result.error];
    return { ok: false, error, fieldErrors: field ? { [field]: error } : undefined };
  }
  refresh();
  return { ok: true };
}

export async function createAccountAction(input: unknown): Promise<ActionResult> {
  // Session first: no parsing work for anonymous requests.
  const space = await getCurrentSpace();
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  return done(await createAccount(space.id, parsed.data));
}

export async function updateAccountAction(id: unknown, input: unknown): Promise<ActionResult> {
  // Session first: no parsing work for anonymous requests.
  const space = await getCurrentSpace();
  const parsedId = accountIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: ACCOUNT_ERROR_MESSAGES.NOT_FOUND };
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  return done(await updateAccount(space.id, parsedId.data, parsed.data));
}

export async function setAccountArchivedAction(
  id: unknown,
  archived: unknown,
): Promise<ActionResult> {
  // Session first: no parsing work for anonymous requests.
  const space = await getCurrentSpace();
  const parsedId = accountIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: ACCOUNT_ERROR_MESSAGES.NOT_FOUND };
  const parsedArchived = z.boolean().safeParse(archived);
  if (!parsedArchived.success) return { ok: false, error: "Dados inválidos." };
  return done(await setAccountArchived(space.id, parsedId.data, parsedArchived.data));
}
