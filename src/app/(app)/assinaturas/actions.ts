"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { MAX_AMOUNT_CENTS } from "@/domain/money";
import { RULE_STATUSES } from "@/domain/recurring";
import type { ActionResult } from "@/lib/action-result";
import {
  RULE_ERROR_MESSAGES,
  type RuleError,
  setRecurringRuleStatus,
  undoSubscription,
  updateRecurringRule,
} from "@/server/recurring";
import { getCurrentSpace } from "@/server/session";

const ruleIdSchema = z.uuid({ error: "Assinatura não encontrada." });
const amountSchema = z
  .number({ error: "Informe o valor." })
  .int({ error: "Valor inválido." })
  .min(1, { error: "O valor precisa ser maior que zero." })
  .max(MAX_AMOUNT_CENTS, { error: "O valor pode ser no máximo R$ 20.000.000,00." });

function done(result: { ok: true } | { ok: false; error: RuleError }): ActionResult {
  if (!result.ok) return { ok: false, error: RULE_ERROR_MESSAGES[result.error] };
  refresh();
  return { ok: true };
}

/** Pauses, resumes or cancels a subscription (canceling is final). */
export async function setRecurringRuleStatusAction(
  id: unknown,
  status: unknown,
): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = ruleIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: RULE_ERROR_MESSAGES.NOT_FOUND };
  const parsedStatus = z.enum(RULE_STATUSES).safeParse(status);
  if (!parsedStatus.success) return { ok: false, error: "Dados inválidos." };
  return done(await setRecurringRuleStatus(space.id, parsedId.data, parsedStatus.data));
}

/** Changes the amount of the next charges and records the change. */
export async function updateRecurringRuleAction(
  id: unknown,
  amountCents: unknown,
): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = ruleIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: RULE_ERROR_MESSAGES.NOT_FOUND };
  const parsedAmount = amountSchema.safeParse(amountCents);
  if (!parsedAmount.success) {
    return { ok: false, error: parsedAmount.error.issues[0]?.message ?? "Valor inválido." };
  }
  return done(
    await updateRecurringRule(space.id, parsedId.data, { amountCents: parsedAmount.data }),
  );
}

/** The "Desfazer" of a new subscription: the charge, and the rule if it had no other charge. */
export async function undoSubscriptionAction(transactionId: unknown): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = z.uuid().safeParse(transactionId);
  if (!parsedId.success) return { ok: false, error: "Lançamento não encontrado." };
  const result = await undoSubscription(space.id, parsedId.data);
  if (!result.ok) return { ok: false, error: "Lançamento não encontrado." };
  refresh();
  return { ok: true };
}
