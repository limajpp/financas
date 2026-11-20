import { randomUUID } from "node:crypto";

import { createSerwistRoute } from "@serwist/turbopack";
import { cacheLife } from "next/cache";

import { OFFLINE_URL } from "@/lib/pwa";

/**
 * Builds the service worker with esbuild from src/sw.ts, with the list of the build's static files
 * to precache. Only at build time: on Vercel the source and those files aren't next to the
 * function. With Cache Components a Route Handler prerenders only if its slow work is cached, and
 * this cache never expires, so the function never rebuilds it.
 */
async function buildServiceWorker() {
  "use cache";
  cacheLife({ revalidate: Infinity, expire: Infinity });
  const serwist = createSerwistRoute({
    // A new id per build: the offline page links to that build's files.
    additionalPrecacheEntries: [{ url: OFFLINE_URL, revision: randomUUID() }],
    swSrc: "src/sw.ts",
    // The defaults, plus the fonts, so the app keeps its look offline.
    globPatterns: [".next/static/**/*.{js,css,html,ico,png,svg,webp,json,woff2}", "public/**/*"],
    useNativeEsbuild: true,
    esbuildOptions: { alias: { "@": "./src" }, sourcemap: false },
  });
  const response = await serwist.GET(new Request("http://localhost/serwist/sw.js"), {
    params: Promise.resolve({ path: "sw.js" }),
  });
  return response.text();
}

export async function GET() {
  return new Response(await buildServiceWorker(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      // A new deploy must reach the browser: the service worker checks for updates on every open.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
