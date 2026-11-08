"use client";

import { SerwistProvider, useSerwist } from "@serwist/turbopack/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Registers the service worker (production builds only: in `next dev` it would serve stale code).
 * Reloading when the network comes back is off: it would throw away a half-filled form.
 */
export function ServiceWorker({ children }: { children: React.ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV !== "production"}
      cacheOnNavigation={false}
      reloadOnOnline={false}
    >
      <CacheVisitedScreens />
      {children}
    </SerwistProvider>
  );
}

/**
 * A screen reached by client navigation has no saved copy for a cold start offline. Asks the
 * service worker to keep one, once per screen while the app is open (not on every filter change,
 * which only touches the query string: each copy is one more server render).
 */
function CacheVisitedScreens() {
  const { serwist } = useSerwist();
  const pathname = usePathname();
  const saved = useRef(new Set<string>());
  useEffect(() => {
    if (!serwist || !navigator.onLine || saved.current.has(pathname)) return;
    saved.current.add(pathname);
    void serwist.messageSW({ type: "CACHE_URLS", payload: { urlsToCache: [pathname] } });
  }, [serwist, pathname]);
  return null;
}
