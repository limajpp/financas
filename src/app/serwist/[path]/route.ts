import { spawnSync } from "node:child_process";

import { createSerwistRoute } from "@serwist/turbopack";
import { cacheLife } from "next/cache";

import { OFFLINE_URL } from "@/lib/pwa";

// The offline page changes only with a new build.
const revision =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ||
  "local";

// Builds /serwist/sw.js with esbuild from src/sw.ts, with the list of the build's static files to
// precache. It must run at build time: on Vercel those files live on the CDN, not next to the
// function.
const serwist = createSerwistRoute({
  additionalPrecacheEntries: [{ url: OFFLINE_URL, revision }],
  swSrc: "src/sw.ts",
  useNativeEsbuild: true,
  esbuildOptions: { alias: { "@": "./src" }, sourcemap: false },
});

const FILES = ["sw.js"];

export async function generateStaticParams() {
  return FILES.map((path) => ({ path }));
}

// With Cache Components a Route Handler prerenders only if its slow work is cached: the build
// output goes into the static response.
async function serwistFile(path: string) {
  "use cache";
  cacheLife("max");
  const response = await serwist.GET(new Request("http://localhost"), {
    params: Promise.resolve({ path }),
  });
  return response.text();
}

export async function GET(_: Request, { params }: RouteContext<"/serwist/[path]">) {
  const { path } = await params;
  if (!FILES.includes(path)) return new Response(null, { status: 404 });
  return new Response(await serwistFile(path), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      // A new deploy must reach the browser: the service worker checks for updates on every open.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
