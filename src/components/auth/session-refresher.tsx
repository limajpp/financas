"use client";

import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";

/**
 * Server Components can extend the session in the database but can't rewrite the cookie, so it
 * would expire 7 days after login even for daily use. This request goes through /api/auth, which can.
 */
export function SessionRefresher() {
  useEffect(() => {
    void authClient.getSession();
  }, []);
  return null;
}
