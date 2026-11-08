/** Shown when there is no network and no saved copy of the screen. */
export const OFFLINE_URL = "/~offline";

/** Where the service worker keeps the screens already opened. */
export const PAGES_CACHE = "pages";

/**
 * The caches that may hold the user's data (screens, API answers). The precache only has the
 * build's static files and the offline page, so it stays.
 */
export function isPrivateCache(name: string) {
  return !name.includes("precache");
}
