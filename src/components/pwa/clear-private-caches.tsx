"use client";

import { useEffect } from "react";

import { isPrivateCache } from "@/lib/pwa";

/**
 * On the login and sign-up screens (after "Sair" or an expired session): deletes the saved screens,
 * which hold financial data, so the next person on the device doesn't see them offline.
 */
export function ClearPrivateCaches() {
  useEffect(() => {
    if (!("caches" in window)) return;
    void caches
      .keys()
      .then((names) => Promise.all(names.filter(isPrivateCache).map((n) => caches.delete(n))));
  }, []);
  return null;
}
