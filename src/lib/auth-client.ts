import { createAuthClient } from "better-auth/react";

// Same origin: talks to /api/auth, where Better Auth applies its rate limit and origin checks.
export const authClient = createAuthClient();
