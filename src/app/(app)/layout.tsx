import { Suspense } from "react";

import { SessionRefresher } from "@/components/auth/session-refresher";
import { BottomNav } from "@/components/nav/bottom-nav";
import { Sidebar } from "@/components/nav/sidebar";
import { OutboxIndicator } from "@/components/outbox/outbox-indicator";
import { OutboxProvider, OutboxUser } from "@/components/outbox/outbox-provider";
import { Toaster } from "@/components/toaster";
import { getCurrentUser } from "@/server/session";

// The navigation is static and prerenders; only the user's name waits for the session.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <OutboxProvider>
      {/* Keyboard users skip the navigation (task 26): shown when it gets the focus. */}
      <a
        href="#conteudo"
        className="sr-only rounded-md bg-background px-3 py-2 text-sm font-medium ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-[calc(0.5rem+env(safe-area-inset-top))] focus:left-2 focus:z-50"
      >
        Pular para o conteúdo
      </a>
      <div className="flex min-h-full flex-1">
        <Sidebar
          user={
            <Suspense fallback={<span className="text-muted-foreground">…</span>}>
              <UserName />
            </Suspense>
          }
        />
        <main
          id="conteudo"
          tabIndex={-1}
          className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] outline-none md:pb-0"
        >
          <OutboxIndicator />
          {children}
        </main>
        <BottomNav />
        <SessionRefresher />
        <Toaster />
        <Suspense>
          <SignedInUser />
        </Suspense>
      </div>
    </OutboxProvider>
  );
}

// Shows the name and, with an invalid session, redirects to the login. It does NOT protect the pages:
// layouts don't re-render on client navigation and the page streams anyway. Every page or action that
// touches data must call getCurrentUser() or getCurrentSpace() itself.
async function UserName() {
  const user = await getCurrentUser();
  return <>{user.name}</>;
}

// The offline queue belongs to a user: it starts once the session says who is signed in.
async function SignedInUser() {
  const user = await getCurrentUser();
  return <OutboxUser userId={user.id} />;
}
