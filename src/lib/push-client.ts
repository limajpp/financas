/** The browser side of the daily reminder (task 17). */

/** A VAPID key (base64url) as the bytes `pushManager.subscribe` wants. */
export function applicationServerKey(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** This device's push subscription, if the service worker is registered and has one. */
export async function currentPushSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager?.getSubscription()) ?? null;
}

/**
 * The subscription "Sair" must cancel, or null. Without the permission there is none, and the
 * push manager isn't even asked (it may take long to answer, delaying the sign-out).
 */
export async function subscriptionToForget() {
  if (!("Notification" in window) || Notification.permission !== "granted") return null;
  return withTimeout(currentPushSubscription(), 3_000).catch(() => null);
}

/** Whether `subscription` was made with `publicKey` (a rotated key leaves it useless: 403). */
export function sameServerKey(subscription: PushSubscription, publicKey: string) {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const expected = applicationServerKey(publicKey);
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((b, i) => b === expected[i]);
}

/** Gives up on `promise` after `ms`: the sign-out mustn't hang on the push service. */
export function withTimeout<T>(promise: Promise<T>, ms: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}
