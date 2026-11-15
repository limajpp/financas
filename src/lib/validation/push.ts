import { z } from "zod";

/**
 * The push services browsers use. The server POSTs to the endpoint every day, so it can't be any
 * address a request names (an internal one, say).
 */
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

export function isPushServiceUrl(value: string) {
  try {
    const url = new URL(value);
    // The host as written must be the host as parsed: web-push connects with Node's legacy URL
    // parser, which doesn't decode "%2E", so "evil.com%2Epush.apple.com" would pass here and
    // reach evil.com there. No port, user or password either.
    const written = /^https:\/\/([^/?#]*)/i.exec(value)?.[1]?.toLowerCase();
    return (
      url.protocol === "https:" &&
      written === url.host &&
      !url.port &&
      !url.username &&
      !url.password &&
      PUSH_SERVICE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

export const pushEndpointSchema = z
  .string()
  .max(2048)
  .refine(isPushServiceUrl, "Serviço de notificação desconhecido.")
  // Saved and compared in one form.
  .transform((value) => new URL(value).href);

/** A browser's `PushSubscription.toJSON()`. */
export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
