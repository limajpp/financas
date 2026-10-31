import { redirect } from "next/navigation";

import { getSession } from "@/server/session";

/** Sends a user with a valid session away from the login and sign-up pages. */
export async function RedirectIfSignedIn() {
  if (await getSession()) redirect("/");
  return null;
}
