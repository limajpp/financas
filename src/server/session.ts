import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/lib/db";
import { auth } from "@/server/auth";
import { ensurePersonalSpace } from "@/server/spaces";

/** The session for this request, or null. Memoized per request. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** The signed-in user. Redirects to the login page when there is no valid session. */
export const getCurrentUser = cache(async () => {
  const session = await getSession();
  if (!session) redirect("/entrar");
  return session.user;
});

/**
 * The space every query must filter by. In v1 it's always the user's personal space,
 * created here if the sign-up hook didn't get to it.
 */
export const getCurrentSpace = cache(async () => {
  const user = await getCurrentUser();
  const space = await ensurePersonalSpace(user.id);
  const { role } = await db.spaceMember.findUniqueOrThrow({
    where: { spaceId_userId: { spaceId: space.id, userId: user.id } },
    select: { role: true },
  });
  return { id: space.id, type: space.type, role };
});
