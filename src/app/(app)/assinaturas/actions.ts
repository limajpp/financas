"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { RULE_STATUSES } from "@/domain/recurring";
import type { ActionResult } from "@/lib/action-result";
import { ruleEditSchema } from "@/lib/validation/subscriptions";
import {
  RULE_ERROR_MESSAGES,
  type RuleError,
  editRecurringRule,
  ruleEditMessage,
  setRecurringRuleStatus,
  undoSubscription,
} from "@/server/recurring";
import { getCurrentSpace } from "@/server/session";

const ruleIdSchema = z.uuid({ error: "Assinatura não encontrada." });

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

/**
 * Edits a subscription for its next charges: amount (recorded in the history), day, category,
 * payment and note.
 */
export async function editRecurringRuleAction(id: unknown, input: unknown): Promise<ActionResult> {
  const space = await getCurrentSpace();
  const parsedId = ruleIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: RULE_ERROR_MESSAGES.NOT_FOUND };
  const parsed = ruleEditSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const result = await editRecurringRule(space.id, parsedId.data, parsed.data);
  if (!result.ok) return { ok: false, error: ruleEditMessage(result.error) };
  refresh();
  return { ok: true };
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
