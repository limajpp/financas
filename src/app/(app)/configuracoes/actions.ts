"use server";

import { headers } from "next/headers";

import { type ActionResult } from "@/lib/action-result";
import { pushEndpointSchema, pushSubscriptionSchema } from "@/lib/validation/push";
import {
  deletePushSubscription,
  hasPushSubscription,
  savePushSubscription,
  sendTestPush,
  vapidPublicKey,
} from "@/server/push";
import { getCurrentUser } from "@/server/session";

const UNAVAILABLE = "Lembretes indisponíveis neste ambiente.";
const INVALID = "Inscrição de notificação inválida.";

/** Turns the daily reminder on for this device (the browser's `PushSubscription.toJSON()`). */
export async function savePushSubscriptionAction(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!vapidPublicKey()) return { ok: false, error: UNAVAILABLE };
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID };
  await savePushSubscription(user.id, parsed.data, (await headers()).get("user-agent"));
  return { ok: true };
}

/** Turns it off for this device. */
export async function deletePushSubscriptionAction(endpoint: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  const parsed = pushEndpointSchema.safeParse(endpoint);
  if (!parsed.success) return { ok: false, error: INVALID };
  await deletePushSubscription(user.id, parsed.data);
  return { ok: true };
}

/** Whether this device's subscription is saved for the signed-in user. */
export async function pushSubscriptionStatusAction(endpoint: unknown): Promise<boolean> {
  const user = await getCurrentUser();
  const parsed = pushEndpointSchema.safeParse(endpoint);
  return parsed.success && (await hasPushSubscription(user.id, parsed.data));
}

export type TestPushActionResult = { ok: true } | { ok: false; error: string; expired?: true };

/** The test notification, to this device only. */
export async function sendTestPushAction(endpoint: unknown): Promise<TestPushActionResult> {
  const user = await getCurrentUser();
  const parsed = pushEndpointSchema.safeParse(endpoint);
  if (!parsed.success) return { ok: false, error: INVALID };
  const result = await sendTestPush(user.id, parsed.data);
  if (result.ok) return result;
  switch (result.error) {
    case "UNAVAILABLE":
      return { ok: false, error: UNAVAILABLE };
    case "NOT_FOUND":
    case "EXPIRED":
      return {
        ok: false,
        error: "A inscrição deste aparelho expirou. Ligue de novo.",
        expired: true,
      };
    case "FAILED":
      return { ok: false, error: "Não foi possível enviar agora. Tente de novo em instantes." };
  }
}
