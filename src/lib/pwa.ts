/** Shown when there is no network and no saved copy of the screen. */
export const OFFLINE_URL = "/~offline";

/** Where the service worker keeps the screens already opened. */
export const PAGES_CACHE = "pages";

/** The message that asks the service worker to forget the saved screens (sign-out). */
export const CLEAR_PRIVATE_CACHES = "CLEAR_PRIVATE_CACHES";

/**
 * The runtime caches that may hold the user's data: screens (HTML and RSC), API answers and the
 * catch-all ones. The precache (the build's files and the offline page) and the caches of fonts,
 * images, scripts and styles stay, so the app still opens offline after signing in again.
 */
const PRIVATE_CACHES = ["apis", "others", "next-data", "static-data-assets", "cross-origin"];

export function isPrivateCache(name: string) {
  return name.startsWith(PAGES_CACHE) || PRIVATE_CACHES.includes(name);
}
