import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The Vercel Cron call carries `Authorization: Bearer <CRON_SECRET>`. Without a configured secret
 * nothing passes: the route never stays open for lack of configuration. Compared in constant time
 * (over hashes, so the length doesn't leak either).
 */
export function isCronAuthorized(authorization: string | null, secret: string | undefined) {
  if (!secret || !authorization) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}
