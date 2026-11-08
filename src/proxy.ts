import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// The offline page is precached by the service worker, which has no session when it installs.
const PUBLIC_PATHS = ["/entrar", "/cadastro", "/~offline"];

// Optimistic check only (cookie present?): it runs on every navigation and prefetch, so no
// database. The real check is getCurrentUser() in src/server/session.ts.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname) || getSessionCookie(request)) return NextResponse.next();

  const login = new URL("/entrar", request.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the auth API, Next internals and files with an extension (icons, images…).
  matcher: ["/((?!api/auth|_next/static|_next/image|.*\\..*).*)"],
};
