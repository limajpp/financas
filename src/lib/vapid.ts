import { authUrls } from "@/server/auth-urls";

type Env = Record<string, string | undefined>;

export type VapidDetails = { subject: string; publicKey: string; privateKey: string };

/**
 * The VAPID keys and the sender's identity, or null when push can't work here. The subject is the
 * app's public URL (on Vercel, from its system variables, as for Better Auth) or VAPID_SUBJECT:
 * it must be https and not localhost, which Apple's push service rejects (BadJwtToken). No
 * personal e-mail in the configuration.
 */
export function vapidDetailsFrom(env: Env): VapidDetails | null {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  const subject = env.VAPID_SUBJECT || authUrls(env).baseURL;
  if (!subject) return null;
  try {
    const url = new URL(subject);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" || local) return null;
    return { subject: url.origin, publicKey, privateKey };
  } catch {
    return null;
  }
}
