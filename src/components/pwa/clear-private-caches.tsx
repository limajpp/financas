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
    const worker = navigator.serviceWorker?.controller;
    if (worker) {
      worker.postMessage({ type: CLEAR_PRIVATE_CACHES });
      return;
    }
    if (!("caches" in window)) return;
    void caches
      .keys()
      .then((names) => Promise.all(names.filter(isPrivateCache).map((n) => caches.delete(n))));
  }, []);
  return null;
}
