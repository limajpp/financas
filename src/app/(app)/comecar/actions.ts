"use server";

import { refresh } from "next/cache";

import { formatBRL } from "@/domain/money";
import { ONGOING_ERROR_MESSAGES, type OngoingError } from "@/domain/onboarding";
import { TRANSACTION_ERROR_MESSAGES, type TransactionError } from "@/domain/transactions";
import type { ActionResult } from "@/lib/action-result";
import {
  ongoingPurchaseSchema,
  openingBalanceSchema,
  subscriptionRuleSchema,
} from "@/lib/validation/onboarding";
import {
  type OnboardingError,
  createOngoingInstallments,
  createSubscriptionRule,
  finishOnboarding,
  setOpeningBalance,
} from "@/server/onboarding";
import { getCurrentSpace, getCurrentUser } from "@/server/session";

function message(error: OnboardingError) {
  if (error === "DUPLICATE_SUBSCRIPTION") return "Essa assinatura já está cadastrada.";
  if (error in ONGOING_ERROR_MESSAGES) return ONGOING_ERROR_MESSAGES[error as OngoingError];
  return TRANSACTION_ERROR_MESSAGES[error as TransactionError];
}

const invalid = (error: { issues: { message: string }[] }): ActionResult => ({
  ok: false,
  error: error.issues[0]?.message ?? "Dados inválidos.",
});

/** What the bank shows on one of a card's invoices today (zero deletes it). */
export async function setOpeningBalanceAction(input: unknown): Promise<ActionResult> {
  const [user, space] = await Promise.all([getCurrentUser(), getCurrentSpace()]);
  const parsed = openingBalanceSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { cardId, dueDate, amountCents } = parsed.data;
  const result = await setOpeningBalance(space.id, user.id, cardId, dueDate, amountCents);
  if (!result.ok) return { ok: false, error: message(result.error) };
  refresh();
  return { ok: true };
}

/**
 * The installments left of a purchase made before the app. Says what came off the open invoice's
 * opening balance, for the screen's notice.
 */
export async function createOngoingAction(
  input: unknown,
): Promise<{ ok: true; notice: string | null } | Extract<ActionResult, { ok: false }>> {
  const [user, space] = await Promise.all([getCurrentUser(), getCurrentSpace()]);
  const parsed = ongoingPurchaseSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const { clientId, input: purchase } = parsed.data;
  const result = await createOngoingInstallments(space.id, user.id, clientId, purchase);
  if (!result.ok) return { ok: false, error: message(result.error) };
  refresh();
  return {
    ok: true,
    notice:
      result.deductedCents > 0
        ? `A parcela ${purchase.current} (${formatBRL(purchase.amountCents)}) já fazia parte da fatura aberta informada.`
        : null,
  };
}

/** A subscription already running: the rule only, charged from its next date on. */
export async function createSubscriptionRuleAction(input: unknown): Promise<ActionResult> {
  const [user, space] = await Promise.all([getCurrentUser(), getCurrentSpace()]);
  const parsed = subscriptionRuleSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const result = await createSubscriptionRule(space.id, user.id, parsed.data);
  if (!result.ok) return { ok: false, error: message(result.error) };
  refresh();
  return { ok: true };
}

/** "Concluir" and "Não mostrar mais": the onboarding isn't offered anymore. */
export async function finishOnboardingAction(): Promise<ActionResult> {
  const space = await getCurrentSpace();
  await finishOnboarding(space.id);
  refresh();
  return { ok: true };
}
