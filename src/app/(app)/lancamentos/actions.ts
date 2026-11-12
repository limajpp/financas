"use server";

import { refresh } from "next/cache";

import { z } from "zod";

import { INSTALLMENT_SCOPES } from "@/domain/transactions";
import { type ActionFailure, type ActionResult, zodFailure } from "@/lib/action-result";
import {
  type TransactionErrorCode as ErrorCode,
  transactionFailure as failure,
} from "@/lib/transaction-failure";
import {
  cardPaymentSchema,
  clientIdSchema,
  entrySchema,
  transactionIdSchema,
  transferSchema,
} from "@/lib/validation/transactions";
import { getCurrentSpace, getCurrentUser } from "@/server/session";
import { type ListCursor, listTransactions } from "@/server/transaction-list";
import {
  BULK_MAX,
  bulkSetCategory,
  createCardPayment,
  createTransaction,
  createTransfer,
  deleteTransaction,
  updateCardPayment,
  updateTransaction,
  updateTransfer,
} from "@/server/transactions";
import { parseFilters } from "@/lib/validation/transaction-filters";
import { isCalendarDate } from "@/domain/dates";

const scopeSchema = z.enum(INSTALLMENT_SCOPES).default("this");

function done(result: { ok: true } | { ok: false; error: ErrorCode }): ActionResult {
  if (!result.ok) {
    // Gone meanwhile (another tab or device): the list updates without it.
    if (result.error === "NOT_FOUND") refresh();
    return failure(result.error);
  }
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

/**
 * Edits an entry; for an installment, `scope` says whether the next ones change too. For a
 * subscription charge, `updateRule: true` is the "yes" to "Atualizar a assinatura?".
 */
export async function updateTransactionAction(
  id: unknown,
  input: unknown,
  scope?: unknown,
  options?: unknown,
): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = transactionIdSchema.safeParse(id);
  if (!parsedId.success) return failure("NOT_FOUND");
  const parsedScope = scopeSchema.safeParse(scope);
  if (!parsedScope.success) return { ok: false, error: "Dados inválidos." };
  const parsedOptions = z
    .object({ updateRule: z.boolean().default(false) })
    .default({ updateRule: false })
    .safeParse(options);
  if (!parsedOptions.success) return { ok: false, error: "Dados inválidos." };
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  return done(
    await updateTransaction(
      space.id,
      parsedId.data,
      parsed.data,
      parsedScope.data,
      parsedOptions.data,
    ),
  );
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

const cursorSchema = z.object({
  date: z.string().refine(isCalendarDate),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

/** The next page of the list for the filters in the URL (the same params as the page). */
export async function listMoreTransactionsAction(params: unknown, cursor: unknown) {
  const space = await getCurrentSpace();
  const parsedParams = z.record(z.string(), z.string()).safeParse(params);
  const parsedCursor = cursorSchema.safeParse(cursor);
  if (!parsedParams.success || !parsedCursor.success) {
    return { ok: false as const, error: "Dados inválidos." };
  }
  const cursorValue: ListCursor = parsedCursor.data;
  const page = await listTransactions(space.id, parseFilters(parsedParams.data), cursorValue);
  return { ok: true as const, page };
}

/** Edits a transfer. */
export async function updateTransferAction(id: unknown, input: unknown): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = transactionIdSchema.safeParse(id);
  if (!parsedId.success) return failure("NOT_FOUND");
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  return done(await updateTransfer(space.id, parsedId.data, parsed.data));
}

/** Edits an invoice payment (its card stays). */
export async function updateCardPaymentAction(id: unknown, input: unknown): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = transactionIdSchema.safeParse(id);
  if (!parsedId.success) return failure("NOT_FOUND");
  const parsed = cardPaymentSchema.safeParse(input);
  if (!parsed.success) return zodFailure(parsed.error);
  return done(await updateCardPayment(space.id, parsedId.data, parsed.data));
}

/** Sets one category (or none, with null) on several expenses or incomes at once. */
export async function bulkSetCategoryAction(
  ids: unknown,
  categoryId: unknown,
): Promise<{ ok: true; count: number } | ActionFailure> {
  const space = await getCurrentSpace();
  const parsedIds = z.array(z.uuid()).min(1).max(BULK_MAX).safeParse(ids);
  if (!parsedIds.success) return { ok: false, error: "Selecione de 1 a 200 lançamentos." };
  const parsedCategory = z.uuid().nullable().safeParse(categoryId);
  if (!parsedCategory.success) return failure("CATEGORY_NOT_FOUND");
  const result = await bulkSetCategory(space.id, parsedIds.data, parsedCategory.data);
  if (!result.ok) return failure(result.error);
  refresh();
  return { ok: true, count: result.count };
}
