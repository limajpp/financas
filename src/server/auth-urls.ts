type Env = Record<string, string | undefined>;

const https = (host: string | undefined) => (host ? `https://${host}` : undefined);

/**
 * Better Auth's base URL and extra trusted origins. BETTER_AUTH_URL wins (local dev, CI). On Vercel
 * they come from its system variables: the production domain, or the preview's own URL; a deployment
 * is also reachable by its unique and branch URLs.
 */
export function authUrls(env: Env) {
  const production = env.VERCEL_ENV === "production";
  const baseURL =
    env.BETTER_AUTH_URL || https(production ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_URL);
  if (env.BETTER_AUTH_URL) return { baseURL, trustedOrigins: [] };

  const trustedOrigins = [
    production ? https(env.VERCEL_PROJECT_PRODUCTION_URL) : undefined,
    https(env.VERCEL_URL),
    https(env.VERCEL_BRANCH_URL),
  ].filter((origin): origin is string => origin !== undefined);
  return { baseURL, trustedOrigins };
}
