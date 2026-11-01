import { Suspense } from "react";

import { SessionRefresher } from "@/components/auth/session-refresher";
import { BottomNav } from "@/components/nav/bottom-nav";
import { Sidebar } from "@/components/nav/sidebar";
import { Toaster } from "@/components/toaster";
import { getCurrentUser } from "@/server/session";

// The navigation is static and prerenders; only the user's name waits for the session.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1">
      <Sidebar
        user={
          <Suspense fallback={<span className="text-muted-foreground">…</span>}>
            <UserName />
          </Suspense>
        }
      />
      <main className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
      <BottomNav />
      <SessionRefresher />
      <Toaster />
    </div>
  );
}

// Shows the name and, with an invalid session, redirects to the login. It does NOT protect the pages:
// layouts don't re-render on client navigation and the page streams anyway. Every page or action that
// touches data must call getCurrentUser() or getCurrentSpace() itself.
async function UserName() {
  const user = await getCurrentUser();
  return <>{user.name}</>;
}
