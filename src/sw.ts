/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, Serwist } from "serwist";

import { OFFLINE_URL, PAGES_CACHE } from "@/lib/pwa";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * The app's screens: the network first, so balances are never stale while online; the last copy
 * when offline. Both document loads and the copies asked for on client navigation (CACHE_URLS)
 * land here, so they share one cache. Redirects (an expired session) and errors aren't kept.
 */
const pages = {
  matcher: ({ request, url, sameOrigin }: { request: Request; url: URL; sameOrigin: boolean }) =>
    sameOrigin &&
    request.method === "GET" &&
    request.headers.get("RSC") !== "1" &&
    !url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/_next/") &&
    !url.pathname.startsWith("/serwist/") &&
    !/\.[a-z0-9]+$/i.test(url.pathname),
  handler: new NetworkFirst({
    cacheName: PAGES_CACHE,
    networkTimeoutSeconds: 8,
    plugins: [
      {
        cacheWillUpdate: async ({ response }) =>
          response.ok && !response.redirected ? response : null,
      },
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [pages, ...defaultCache],
  fallbacks: {
    entries: [{ url: OFFLINE_URL, matcher: ({ request }) => request.destination === "document" }],
  },
});

serwist.addEventListeners();
