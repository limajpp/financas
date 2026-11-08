"use client";

import { useEffect } from "react";

import { CLEAR_PRIVATE_CACHES, isPrivateCache } from "@/lib/pwa";

/**
 * On the login and sign-up screens (after "Sair" or an expired session): deletes the saved screens,
 * which hold financial data, so the next person on the device doesn't see them offline. The
 * service worker does it, so a screen still loading can't be saved after the purge.
 */
export function ClearPrivateCaches() {
  useEffect(() => {
    // The worker also drops what was still loading. The page deletes too, in case the message
    // reaches a worker that a new deploy has just replaced.
    navigator.serviceWorker?.controller?.postMessage({ type: CLEAR_PRIVATE_CACHES });
    if (!("caches" in window)) return;
    void caches
      .keys()
      .then((names) => Promise.all(names.filter(isPrivateCache).map((n) => caches.delete(n))));
  }, []);
  return null;
}
