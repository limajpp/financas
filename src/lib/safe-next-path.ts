const BASE = "http://internal.invalid";

/** Returns `next` if it's a path on this site, otherwise "/". Guards the post-login redirect. */
export function safeNextPath(next: unknown): string {
  if (
    typeof next !== "string" ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\")
  ) {
    return "/";
  }
  try {
    return new URL(next, BASE).origin === BASE ? next : "/";
  } catch {
    return "/";
  }
}
