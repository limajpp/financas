"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { pushEndpointSchema } from "@/lib/validation/push";
import { auth } from "@/server/auth";
import { deletePushSubscription } from "@/server/push";

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/entrar");
}

/**
 * Ends the session and answers, without redirecting: "Sair" has things to delete on the device
 * once the sign-out has really happened, and then loads the login screen itself.
 */
export async function endSessionAction(pushEndpoint?: unknown): Promise<{ ok: true }> {
  const requestHeaders = await headers();
  // This device stops getting the reminders (task 17). Same action, so nothing queues before the
  // sign-out; best effort: the server also drops it at the next send (410).
  const endpoint = pushEndpointSchema.safeParse(pushEndpoint);
  if (endpoint.success) {
    try {
      const session = await auth.api.getSession({ headers: requestHeaders });
      if (session) await deletePushSubscription(session.user.id, endpoint.data);
    } catch (error) {
      console.error("sign-out: push subscription not deleted", error);
    }
  }
  await auth.api.signOut({ headers: requestHeaders });
  return { ok: true };
}
