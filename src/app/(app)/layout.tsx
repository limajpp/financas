import { Suspense } from "react";

import { BottomNav } from "@/components/nav/bottom-nav";
import { Sidebar } from "@/components/nav/sidebar";
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
    </div>
  );
}

// Also the session check for every page in the app: with an invalid session it redirects to the login.
async function UserName() {
  const user = await getCurrentUser();
  return <>{user.name}</>;
}
