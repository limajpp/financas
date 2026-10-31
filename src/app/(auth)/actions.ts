"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/entrar");
}
