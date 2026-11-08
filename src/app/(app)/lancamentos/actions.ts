"use server";

import { refresh } from "next/cache";

import { z } from "zod";

import { INSTALLMENT_SCOPES, TRANSACTION_ERROR_MESSAGES } from "@/domain/transactions";
import { type ActionFailure, type ActionResult, zodFailure } from "@/lib/action-result";
import {
  cardPaymentSchema,
  clientIdSchema,
  entrySchema,
  transactionIdSchema,
  transferSchema,
} from "@/lib/validation/transactions";
import { getCurrentSpace, getCurrentUser } from "@/server/session";
import {
  createCardPayment,
  createTransaction,
  createTransfer,
  deleteTransaction,
  updateTransaction,
} from "@/server/transactions";

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
  SAME_ACCOUNT: "toAccountId",
  TO_ACCOUNT_NOT_FOUND: "toAccountId",
  TO_ACCOUNT_ARCHIVED: "toAccountId",
  TOO_SMALL_FOR_INSTALLMENTS: "amountCents",
  INSTALLMENT_AMOUNT_SCOPE: "amountCents",
  INSTALLMENTS_ON_EDIT: "installments",
};

const scopeSchema = z.enum(INSTALLMENT_SCOPES).default("this");

function failure(code: ErrorCode): ActionFailure {
  const error = TRANSACTION_ERROR_MESSAGES[code];
  const field = FIELD_OF_ERROR[code];
  return { ok: false, error, fieldErrors: field ? { [field]: error } : undefined };
}

function done(result: { ok: true } | { ok: false; error: ErrorCode }): ActionResult {
  if (!result.ok) return failure(result.error);
  refresh();
  return { ok: true };
}

/**
 * Creates an expense or income and returns its id (for "Desfazer"). Sending the same `clientId`
 * again doesn't duplicate it.
 */
export async function createTransactionAction(
  clientId: unknown,
  input: unknown,
): Promise<{ ok: true; id: string } | ActionFailure> {
  const [user, space] = await Promise.all([getCurrentUser(), getCurrentSpace()]);
  const parsedClientId = clientIdSchema.safeParse(clientId);
  if (!parsedClientId.success) return zodFailure(parsedClientId.error);
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  const result = await createTransaction(space.id, user.id, parsedClientId.data, parsed.data);
  if (!result.ok) return failure(result.error);
  // No refresh(): the register screen navigates away right after, and the pages are dynamic, so
  // the next one already reads the new entry.
  return { ok: true, id: result.transaction.id };
}

/** Creates a transfer between two accounts and returns its id. Idempotent by `clientId`. */
export async function createTransferAction(
  clientId: unknown,
  input: unknown,
): Promise<{ ok: true; id: string } | ActionFailure> {
  const [user, space] = await Promise.all([getCurrentUser(), getCurrentSpace()]);
  const parsedClientId = clientIdSchema.safeParse(clientId);
  if (!parsedClientId.success) return zodFailure(parsedClientId.error);
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  const result = await createTransfer(space.id, user.id, parsedClientId.data, parsed.data);
  if (!result.ok) return failure(result.error);
  // No refresh(): the register screen navigates away right after.
  return { ok: true, id: result.transaction.id };
}

/**
 * Pays a card's invoice and returns the payment's id. Idempotent by `clientId`. Refreshes: the
 * accounts screen, where the dialog lives, shows the new balance.
 */
export async function createCardPaymentAction(
  clientId: unknown,
  input: unknown,
): Promise<{ ok: true; id: string } | ActionFailure> {
  const [user, space] = await Promise.all([getCurrentUser(), getCurrentSpace()]);
  const parsedClientId = clientIdSchema.safeParse(clientId);
  if (!parsedClientId.success) return zodFailure(parsedClientId.error);
  const parsed = cardPaymentSchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  const result = await createCardPayment(space.id, user.id, parsedClientId.data, parsed.data);
  if (!result.ok) return failure(result.error);
  refresh();
  return { ok: true, id: result.transaction.id };
}

/** Edits an entry; for an installment, `scope` says whether the next ones change too. */
export async function updateTransactionAction(
  id: unknown,
  input: unknown,
  scope?: unknown,
): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = transactionIdSchema.safeParse(id);
  if (!parsedId.success) return failure("NOT_FOUND");
  const parsedScope = scopeSchema.safeParse(scope);
  if (!parsedScope.success) return { ok: false, error: "Dados inválidos." };
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  return done(await updateTransaction(space.id, parsedId.data, parsed.data, parsedScope.data));
}

/**
 * Deletes an entry; for an installment, scope "following" also deletes the next ones of its
 * purchase (the "Desfazer" of a purchase in installments sends it from the 1st).
 */
export async function deleteTransactionAction(id: unknown, scope?: unknown): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = transactionIdSchema.safeParse(id);
  if (!parsedId.success) return failure("NOT_FOUND");
  const parsedScope = scopeSchema.safeParse(scope);
  if (!parsedScope.success) return { ok: false, error: "Dados inválidos." };
  return done(await deleteTransaction(space.id, parsedId.data, parsedScope.data));
}
