"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/entrar");
}

/**
 * Ends the session and answers, without redirecting: "Sair" has things to delete on the device
 * once the sign-out has really happened, and then loads the login screen itself.
 */
export async function endSessionAction(): Promise<{ ok: true }> {
  await auth.api.signOut({ headers: await headers() });
  return { ok: true };
}
