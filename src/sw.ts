/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig, SerwistPlugin } from "serwist";
import { CacheExpiration, ExpirationPlugin, NetworkFirst, Serwist, Strategy } from "serwist";

import { CLEAR_PRIVATE_CACHES, isPrivateCache, OFFLINE_URL, PAGES_CACHE } from "@/lib/pwa";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Bumped by every sign-out. A response whose request started before it isn't saved: a screen
 * still loading when "Sair" was tapped would otherwise land in the cache after it was cleared.
 */
let generation = 0;
const signOutGuard: SerwistPlugin = {
  handlerWillStart: async ({ state }) => {
    if (state) state.generation = generation;
  },
  cacheWillUpdate: async ({ response, state }) =>
    state?.generation === generation ? response : null,
};

/**
 * The app's screens: the network first, so balances are never stale while online (no timeout:
 * offline, the request fails fast anyway); the last copy when offline. Both document loads and
 * the copies asked for on client navigation (CACHE_URLS) land here, so they share one cache.
 * Redirects (an expired session) and errors aren't kept.
 */
const pages: RuntimeCaching = {
  matcher: ({ request, url, sameOrigin }) =>
    sameOrigin &&
    request.method === "GET" &&
    request.headers.get("RSC") !== "1" &&
    !url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/_next/") &&
    !url.pathname.startsWith("/serwist/") &&
    !/\.[a-z0-9]+$/i.test(url.pathname),
  handler: new NetworkFirst({
    cacheName: PAGES_CACHE,
    plugins: [
      {
        cacheWillUpdate: async ({ response }) =>
          response.ok && !response.redirected ? response : null,
      },
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  }),
};

const runtimeCaching = [pages, ...defaultCache];
/** The strategies whose caches may hold the user's data (all NetworkFirst). */
const privateStrategies = runtimeCaching.flatMap(({ handler }) =>
  handler instanceof Strategy && isPrivateCache(handler.cacheName) ? [handler] : [],
);
// Only these: on a CacheFirst strategy, any cacheWillUpdate plugin turns off its own "200 only"
// check, and the static files never needed the guard.
for (const strategy of privateStrategies) strategy.plugins.push(signOutGuard);

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [{ url: OFFLINE_URL, matcher: ({ request }) => request.destination === "document" }],
  },
});

/**
 * Deletes the saved screens and API answers, and the expiration records that keep their URLs
 * (search terms included) in IndexedDB.
 */
async function clearPrivateCaches() {
  generation++;
  const names = (await caches.keys()).filter(isPrivateCache);
  await Promise.all(
    names.map(async (name) => {
      // The expiration records live in IndexedDB, apart from the cache.
      await new CacheExpiration(name, { maxEntries: 1 }).delete();
      await caches.delete(name);
    }),
  );
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== CLEAR_PRIVATE_CACHES) return;
  const done = clearPrivateCaches();
  event.waitUntil(done);
  void done.then(() => event.ports[0]?.postMessage(true));
});

serwist.addEventListeners();
