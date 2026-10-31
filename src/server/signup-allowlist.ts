/**
 * SIGNUP_ALLOWED_EMAILS (comma-separated) closes sign-up to everyone else. Unset or empty: open.
 * The app and the repo are public, so production sets it.
 */
export function isSignUpAllowed(email: string): boolean {
  const allowed = (process.env.SIGNUP_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.length === 0 || allowed.includes(email.trim().toLowerCase());
}
