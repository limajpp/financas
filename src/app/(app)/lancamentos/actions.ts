"use server";

import { refresh } from "next/cache";

import { TRANSACTION_ERROR_MESSAGES } from "@/domain/transactions";
import { type ActionResult, zodFailure } from "@/lib/action-result";
import { clientIdSchema, entrySchema, transactionIdSchema } from "@/lib/validation/transactions";
import { getCurrentSpace, getCurrentUser } from "@/server/session";
import { createTransaction, deleteTransaction, updateTransaction } from "@/server/transactions";

type ErrorCode = keyof typeof TRANSACTION_ERROR_MESSAGES;

const FIELD_OF_ERROR: Partial<Record<ErrorCode, string>> = {
  FUTURE_DATE: "date",
  DATE_TOO_OLD: "date",
  METHOD_NOT_ALLOWED: "method",
  ACCOUNT_NOT_FOUND: "accountId",
  ACCOUNT_ARCHIVED: "accountId",
  CARD_NOT_FOUND: "cardId",
  CARD_ARCHIVED: "cardId",
  CATEGORY_NOT_FOUND: "categoryId",
  CATEGORY_ARCHIVED: "categoryId",
  CATEGORY_TYPE_MISMATCH: "categoryId",
  INVALID_INVOICE: "invoiceDueDate",
};

function failure(code: ErrorCode): ActionResult {
  const error = TRANSACTION_ERROR_MESSAGES[code];
  const field = FIELD_OF_ERROR[code];
  return { ok: false, error, fieldErrors: field ? { [field]: error } : undefined };
}

function done(result: { ok: true } | { ok: false; error: ErrorCode }): ActionResult {
  if (!result.ok) return failure(result.error);
  refresh();
  return { ok: true };
}

/** Creates an expense or income. Sending the same `clientId` again doesn't duplicate it. */
export async function createTransactionAction(
  clientId: unknown,
  input: unknown,
): Promise<ActionResult> {
  const [user, space] = await Promise.all([getCurrentUser(), getCurrentSpace()]);
  const parsedClientId = clientIdSchema.safeParse(clientId);
  if (!parsedClientId.success) return zodFailure(parsedClientId.error);
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  return done(await createTransaction(space.id, user.id, parsedClientId.data, parsed.data));
}

export async function updateTransactionAction(id: unknown, input: unknown): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = transactionIdSchema.safeParse(id);
  if (!parsedId.success) return failure("NOT_FOUND");
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  return done(await updateTransaction(space.id, parsedId.data, parsed.data));
}

export async function deleteTransactionAction(id: unknown): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = transactionIdSchema.safeParse(id);
  if (!parsedId.success) return failure("NOT_FOUND");
  return done(await deleteTransaction(space.id, parsedId.data));
}
