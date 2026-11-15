"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { MAX_AMOUNT_CENTS } from "@/domain/money";
import { accountIdSchema } from "@/lib/validation/accounts";
import { clientIdSchema } from "@/lib/validation/transactions";
import {
  RECONCILE_ERROR_MESSAGES,
  compareBalance,
  reconcileAccount,
} from "@/server/reconciliation";
import { getCurrentSpace, getCurrentUser } from "@/server/session";

/** The bank's balance in cents: it may be negative (overdraft). */
const bankBalanceSchema = z
  .number({ error: "Informe o saldo do banco." })
  .int({ error: "Valor inválido." })
  .min(-MAX_AMOUNT_CENTS, { error: "Valor fora do limite." })
  .max(MAX_AMOUNT_CENTS, { error: "Valor fora do limite." });

const notFound = { ok: false as const, error: RECONCILE_ERROR_MESSAGES.NOT_FOUND };

/** Compares the bank's balance with the app's and lists the account's latest entries. */
export async function compareBalanceAction(accountId: unknown, bankBalanceCents: unknown) {
  const space = await getCurrentSpace();
  const id = accountIdSchema.safeParse(accountId);
  if (!id.success) return notFound;
  const balance = bankBalanceSchema.safeParse(bankBalanceCents);
  if (!balance.success) {
    return { ok: false as const, error: balance.error.issues[0]?.message ?? "Valor inválido." };
  }
  const result = await compareBalance(space.id, id.data, balance.data);
  if (!result.ok) return { ok: false as const, error: RECONCILE_ERROR_MESSAGES[result.error] };
  return result;
}

/**
 * Marks the account as reconciled when it matches; with `adjust`, creates the adjustment that
 * closes the difference first. Returns the adjustment's id, for "Desfazer".
 */
export async function reconcileAccountAction(
  accountId: unknown,
  bankBalanceCents: unknown,
  adjust: unknown,
  clientId: unknown,
) {
  const [user, space] = await Promise.all([getCurrentUser(), getCurrentSpace()]);
  const id = accountIdSchema.safeParse(accountId);
  if (!id.success) return notFound;
  const balance = bankBalanceSchema.safeParse(bankBalanceCents);
  const parsedAdjust = z.boolean().safeParse(adjust);
  const parsedClientId = clientIdSchema.safeParse(clientId);
  if (!balance.success || !parsedAdjust.success || !parsedClientId.success) {
    return { ok: false as const, error: "Dados inválidos." };
  }
  const result = await reconcileAccount(space.id, user.id, id.data, balance.data, {
    adjust: parsedAdjust.data,
    clientId: parsedClientId.data,
  });
  if (!result.ok) return { ok: false as const, error: RECONCILE_ERROR_MESSAGES[result.error] };
  refresh();
  return result;
}
