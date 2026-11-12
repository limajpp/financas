import { expect, test, type Page } from "@playwright/test";

import { signOut, signUp } from "./helpers";

// The service worker only exists in production builds (in `next dev` it would serve stale code):
// CI runs the e2e against `npm run start`; locally, `npm run build` and then CI=1.
const production = !!process.env.CI;

/** Waits until the service worker controls the page and has a saved copy of `path`. */
async function waitForSavedScreen(page: Page, path: string) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(
      () =>
        page.evaluate(async (p) => {
          if (!navigator.serviceWorker.controller) return false;
          const cache = await caches.open("pages");
          return !!(await cache.match(new URL(p, location.origin).href));
        }, path),
      { timeout: 30_000 },
    )
    .toBe(true);
}

test("manifest, ícones, página offline e service worker respondem sem sessão", async ({
  request,
}) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({
    name: "Finanças",
    display: "standalone",
    start_url: "/",
    icons: expect.arrayContaining([expect.objectContaining({ sizes: "512x512" })]),
  });
  for (const path of [
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/apple-icon.png",
    "/~offline",
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
  }
  if (production) {
    const sw = await request.get("/serwist/sw.js", { maxRedirects: 0 });
    expect(sw.status()).toBe(200);
    expect(sw.headers()["content-type"]).toContain("javascript");
  }
});

test("o app é instalável (Chromium)", async ({ page, browserName }) => {
  test.skip(!production, "Service worker só no build de produção");
  test.skip(browserName !== "chromium", "A checagem de instalação é do Chromium");
  await signUp(page);
  await waitForSavedScreen(page, "/");

  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
});

test("sem rede, a tela já aberta vem do aparelho e uma nova mostra o aviso", async ({
  page,
  isMobile,
}) => {
  test.skip(!production, "Service worker só no build de produção");
  const { name } = await signUp(page);
  await waitForSavedScreen(page, "/");
  // Reached by client navigation: saved too.
  await page.getByRole("link", { name: "Lançamentos" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Lançamentos" })).toBeVisible();
  await waitForSavedScreen(page, "/lancamentos");

  await page.context().setOffline(true);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: `Olá, ${name}` })).toBeVisible();
  await page.goto("/lancamentos");
  await expect(page.getByRole("heading", { level: 1, name: "Lançamentos" })).toBeVisible();
  // Never opened: the offline page.
  await page.goto("/estabelecimentos");
  await expect(page.getByRole("heading", { name: "Você está sem conexão" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();

  await page.context().setOffline(false);
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Estabelecimentos" })).toBeVisible();

  // Signing out deletes the saved screens; the offline page stays. The login screen itself is
  // saved again as it opens, and has no data.
  await signOut(page, isMobile);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const paths: string[] = [];
        for (const name of await caches.keys()) {
          if (name.includes("precache")) continue;
          const cache = await caches.open(name);
          for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
        }
        return paths.filter((p) => p !== "/entrar" && p !== "/cadastro");
      }),
    )
    .toEqual([]);
  expect(
    await page.evaluate(async () => (await caches.keys()).some((k) => k.includes("precache"))),
  ).toBe(true);
});

test("o cartão de instalação aparece só no Safari do iPhone e some com Agora não", async ({
  page,
  browserName,
}) => {
  await signUp(page);
  const card = page.getByRole("region", { name: "Instale o app" });
  if (browserName !== "webkit") {
    await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();
    await expect(card).toBeHidden();
    return;
  }
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Agora não" }).click();
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();
  await expect(card).toBeHidden();
});
