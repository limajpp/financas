"use client";

import { SerwistProvider, useSerwist } from "@serwist/turbopack/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
  const saved = useRef<Set<string> | null>(null);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    // The first screen came through the service worker already, if it was in charge.
    if (saved.current === null) {
      saved.current = new Set(navigator.serviceWorker?.controller ? [location.pathname] : []);
    }
    const done = saved.current;
    if (!serwist || !online || !navigator.onLine || done.has(pathname)) return;
    done.add(pathname);
    // Without a real connection (online but nothing gets through) the screen is tried again later.
    const retry = setTimeout(() => done.delete(pathname), 30_000);
    void serwist
      .messageSW({ type: "CACHE_URLS", payload: { urlsToCache: [pathname] } })
      .then(() => clearTimeout(retry));
  }, [serwist, pathname, online]);
  return null;
}
