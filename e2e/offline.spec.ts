import { expect, type Page, test } from "@playwright/test";

import { signIn, signUp } from "./helpers";

// Task 16: docs/specs/tasks/16-offline-queue.md. These don't need the service worker: the register
// screen is opened with the network on, and only then the browser goes offline.

// On the dev server, WebKit loses the page when the network is cut (clicks and page.evaluate hang
// until the test times out), which the production build doesn't do. CI runs both browsers against
// the production build; locally, `npm run build` and then CI=1.
test.beforeEach(({ browserName }) => {
  test.skip(
    !process.env.CI && browserName === "webkit",
    "Offline no WebKit só no build de produção",
  );
});

async function createAccount(page: Page, name: string, balance: string) {
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill(name);
  await dialog.getByLabel("Saldo inicial em reais").fill(balance);
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
}

async function typeAmount(page: Page, digits: string) {
  const keypad = page.getByRole("group", { name: "Teclado numérico" });
  for (const digit of digits) {
    await keypad.getByRole("button", { name: digit, exact: true }).click();
  }
}

/** Navigates through the links (see e2e/register.spec.ts). */
async function open(page: Page, name: "Contas" | "Registrar" | "Lançamentos") {
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(
    name === "Contas" ? /\/contas$/ : name === "Registrar" ? /\/registrar$/ : /\/lancamentos/,
  );
}

const accountRow = (page: Page, name: string) =>
  page.getByRole("list", { name: "Contas" }).getByRole("listitem").filter({ hasText: name });

const row = (page: Page, isMobile: boolean, text: string) =>
  isMobile
    ? page.getByRole("listitem").filter({ hasText: text })
    : page.getByRole("row").filter({ hasText: text });

const indicator = (page: Page, text: string | RegExp) => page.getByRole("button", { name: text });
const save = (page: Page) => page.getByRole("button", { name: /^Salvar/ });
const amount = (page: Page) => page.getByRole("status", { name: "Valor" });

/** How many entries the device's queue holds, read straight from IndexedDB. */
function queued(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("financas");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("outbox")) return resolve(0);
          const count = db.transaction("outbox").objectStore("outbox").count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
          count.onerror = () => reject(count.error);
        };
      }),
  );
}

/** Signs up with two accounts and leaves the register screen open, ready to go offline. */
async function setup(page: Page) {
  const user = await signUp(page);
  await page.goto("/contas");
  await createAccount(page, "Banco Azul", "1.000,00");
  await createAccount(page, "Banco Verde", "500,00");
  await open(page, "Registrar");
  await expect(save(page)).toBeDisabled();
  return user;
}

/** Registers an expense with the browser offline: it stays on the device. */
async function registerOffline(page: Page, what: string, digits: string) {
  await typeAmount(page, digits);
  const value = await amount(page).innerText();
  await page.getByLabel("O que foi?").fill(what);
  await save(page).click();
  await expect(page.getByText(`Despesa de ${value} salva no aparelho`)).toBeVisible();
}

test("registra offline e sincroniza ao reconectar, uma vez só (CA1)", async ({
  page,
  context,
  isMobile,
}) => {
  test.slow();
  await setup(page);

  await context.setOffline(true);
  await registerOffline(page, "Padaria Offline", "4790");
  await expect(page.getByText("Ela será enviada quando a conexão voltar.")).toBeVisible();
  // The screen stays, blank, for the next entry.
  await expect(page).toHaveURL(/\/registrar$/);
  await expect(amount(page)).toHaveText("R$ 0,00");
  await expect(indicator(page, "1 lançamento aguardando sincronização")).toBeVisible();

  await registerOffline(page, "Mercado Offline", "1000");
  await expect(indicator(page, "2 lançamentos aguardando sincronização")).toBeVisible();
  // The list of what is waiting.
  await indicator(page, /aguardando sincronização/).click();
  const waiting = page.getByRole("list", { name: "Lançamentos aguardando" }).getByRole("listitem");
  await expect(waiting).toHaveCount(2);
  await expect(waiting.first()).toContainText("Padaria Offline");
  await expect(waiting.first()).toContainText("R$ 47,90");
  await page.keyboard.press("Escape");
  expect(await queued(page)).toBe(2);

  await context.setOffline(false);
  await expect(page.getByText("2 lançamentos sincronizados")).toBeVisible({ timeout: 30_000 });
  await expect(indicator(page, /aguardando sincronização|com erro/)).toBeHidden();
  expect(await queued(page)).toBe(0);

  await open(page, "Lançamentos");
  await expect(row(page, isMobile, "Padaria Offline")).toHaveCount(1);
  await expect(row(page, isMobile, "Mercado Offline")).toHaveCount(1);
  await open(page, "Contas");
  await expect(accountRow(page, "Banco Azul")).toContainText("Saldo atual R$ 942,10");
});

test("aberto já sem rede, pelo service worker, o registro guarda e depois sincroniza", async ({
  page,
  context,
  isMobile,
}) => {
  // The service worker only exists in production builds (see e2e/pwa.spec.ts).
  test.skip(!process.env.CI, "Service worker só no build de produção");
  test.slow();
  await setup(page);
  // The register screen has a saved copy once the worker is in charge.
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          if (!navigator.serviceWorker.controller) return false;
          const cache = await caches.open("pages");
          return !!(await cache.match(new URL("/registrar", location.origin).href));
        }),
      { timeout: 30_000 },
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(save(page)).toBeDisabled();
  await registerOffline(page, "Padaria do Metrô", "4790");
  await expect(indicator(page, "1 lançamento aguardando sincronização")).toBeVisible();
  // Closing and opening the app again, still offline: the entry is still waiting.
  await page.reload();
  await expect(indicator(page, "1 lançamento aguardando sincronização")).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText("1 lançamento sincronizado")).toBeVisible({ timeout: 30_000 });
  await expect(indicator(page, /aguardando sincronização|com erro/)).toBeHidden();
  await open(page, "Lançamentos");
  await expect(row(page, isMobile, "Padaria do Metrô")).toHaveCount(1);
});

test("desfazer tira o lançamento da fila", async ({ page, context }) => {
  await setup(page);
  await context.setOffline(true);
  await registerOffline(page, "Padaria Offline", "4790");
  await page
    .getByRole("listitem")
    .filter({ hasText: "salva no aparelho" })
    .getByRole("button", { name: "Desfazer" })
    .click();
  await expect(page.getByText("Lançamento desfeito.")).toBeVisible();
  await expect(indicator(page, /aguardando sincronização/)).toBeHidden();
  expect(await queued(page)).toBe(0);
});

test("a transferência e a compra parcelada feitas offline sincronizam (CA10)", async ({
  page,
  context,
}) => {
  test.slow();
  await signUp(page);
  await page.goto("/contas");
  await createAccount(page, "Banco Azul", "1.000,00");
  await createAccount(page, "Banco Verde", "500,00");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Novo cartão" }).click();
  await dialog.getByLabel("Nome").fill("Cartão Roxo");
  await dialog.getByLabel("Fecha dia").selectOption("3");
  await dialog.getByLabel("Vence dia").selectOption("10");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await open(page, "Registrar");
  await expect(save(page)).toBeDisabled();

  await context.setOffline(true);
  // R$ 300,00 em 3× no Cartão Roxo.
  await page.getByRole("button", { name: /^Forma de pagamento:/ }).click();
  await dialog.getByRole("button", { name: "Crédito" }).click();
  await dialog.getByRole("button", { name: "Cartão Roxo" }).click();
  await typeAmount(page, "30000");
  await page.getByLabel("Parcelado").click();
  await page.getByLabel("Número de parcelas").selectOption("3");
  await save(page).click();
  await expect(page.getByText("Despesa de R$ 300,00 salva no aparelho")).toBeVisible();
  // R$ 200,00 do Banco Azul para o Banco Verde.
  await page
    .getByRole("group", { name: "Tipo" })
    .getByRole("button", { name: "Transferência" })
    .click();
  await typeAmount(page, "20000");
  await save(page).click();
  await expect(page.getByText("Transferência de R$ 200,00 salva no aparelho")).toBeVisible();
  await expect(indicator(page, "2 lançamentos aguardando sincronização")).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText("2 lançamentos sincronizados")).toBeVisible({ timeout: 30_000 });

  await open(page, "Contas");
  await expect(accountRow(page, "Banco Azul")).toContainText("Saldo atual R$ 800,00");
  await expect(accountRow(page, "Banco Verde")).toContainText("Saldo atual R$ 700,00");
  await page.getByRole("button", { name: "Pagar fatura Cartão Roxo" }).click();
  const invoices = dialog.getByLabel("Fatura (vencimento)");
  await expect(invoices.locator("option", { hasText: "R$ 100,00 a pagar" })).toHaveCount(3);
});

test("um lançamento na fila pode ser descartado", async ({ page, context }) => {
  await setup(page);
  await context.setOffline(true);
  await registerOffline(page, "Padaria Offline", "4790");
  await indicator(page, "1 lançamento aguardando sincronização").click();
  const item = page.getByRole("list", { name: "Lançamentos aguardando" }).getByRole("listitem");
  await item.getByRole("button", { name: "Descartar" }).click();
  await expect(item).toContainText("Descartar este lançamento?");
  await item.getByRole("button", { name: "Cancelar" }).click();
  await item.getByRole("button", { name: "Descartar" }).click();
  await item.getByRole("button", { name: "Sim, descartar" }).click();
  await expect(page.getByText("Lançamento descartado.")).toBeVisible();
  await expect(indicator(page, /aguardando sincronização/)).toBeHidden();
  expect(await queued(page)).toBe(0);
});

// These hold the sync back with page.route(), which doesn't see the requests of a page under a
// service worker in WebKit. The queue doesn't depend on the worker.
test.describe("com o envio retido", () => {
  test.use({ serviceWorkers: "block" });

  test("um lançamento recusado aparece com o motivo e pode ser corrigido (CA8)", async ({
    page,
    context,
    isMobile,
  }) => {
    test.slow();
    await setup(page);
    await context.setOffline(true);
    await registerOffline(page, "Padaria Offline", "4790");

    // The connection is back, but the sync doesn't get through yet; meanwhile the account the entry
    // was paid from is archived.
    await page.route("**/api/sync", (route) => route.abort());
    await context.setOffline(false);
    await page.goto("/contas");
    await page.getByRole("button", { name: "Arquivar Banco Azul" }).click();
    await expect(accountRow(page, "Banco Azul")).toBeHidden();
    await expect(indicator(page, "1 lançamento aguardando sincronização")).toBeVisible();

    await page.unroute("**/api/sync");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(indicator(page, "1 lançamento com erro")).toBeVisible({ timeout: 30_000 });

    await indicator(page, "1 lançamento com erro").click();
    const item = page.getByRole("list", { name: "Lançamentos aguardando" }).getByRole("listitem");
    await expect(item).toContainText("Padaria Offline");
    await expect(item.getByRole("alert")).toContainText(/arquivada/i);
    await item.getByRole("link", { name: "Corrigir" }).click();

    // The register screen comes filled, with the reason, and the payment falls to an active account.
    await expect(page).toHaveURL(/\/registrar\?corrigir=/);
    await expect(amount(page)).toHaveText("R$ 47,90");
    await expect(page.getByLabel("O que foi?")).toHaveValue("Padaria Offline");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(/arquivada/i);
    await expect(page.getByRole("button", { name: /^Forma de pagamento:/ })).toContainText(
      "Banco Verde",
    );
    await save(page).click();
    await expect(page.getByText("Despesa de R$ 47,90 salva", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();
    await expect(indicator(page, /com erro|aguardando sincronização/)).toBeHidden();
    expect(await queued(page)).toBe(0);

    await page.goto("/lancamentos");
    await expect(row(page, isMobile, "Padaria Offline")).toHaveCount(1);
  });

  test("sair com lançamento não enviado pede confirmação e apaga a fila (CA9)", async ({
    page,
    context,
    isMobile,
  }) => {
    test.slow();
    const { email } = await setup(page);
    await page.route("**/api/sync", (route) => route.abort());
    await context.setOffline(true);
    await registerOffline(page, "Padaria Offline", "4790");
    await context.setOffline(false);

    if (isMobile) await page.goto("/configuracoes");
    await expect(indicator(page, "1 lançamento aguardando sincronização")).toBeVisible();
    const dialog = page.getByRole("dialog");
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await expect(dialog).toContainText(
      "Há 1 lançamento que ainda não foi enviado. Sair vai apagá-lo deste aparelho.",
    );
    // Cancelar keeps the session and the queue.
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();
    expect(await queued(page)).toBe(1);

    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await dialog.getByRole("button", { name: "Sair e apagar" }).click();
    await expect(page).toHaveURL(/\/entrar$/);
    await expect.poll(() => queued(page)).toBe(0);

    // Back in, nothing waits and nothing was created.
    await page.unroute("**/api/sync");
    await signIn(page, email);
    await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();
    await expect(indicator(page, /aguardando sincronização/)).toBeHidden();
    await page.goto("/lancamentos");
    await expect(page.getByText("Padaria Offline")).toHaveCount(0);
  });

  test("com a sessão expirada, o lançamento espera o novo login e é enviado sozinho", async ({
    page,
    context,
    isMobile,
  }) => {
    test.slow();
    const { email } = await setup(page);
    await page.route("**/api/sync", (route) =>
      route.fulfill({ status: 401, json: { error: "Sessão expirada. Entre de novo." } }),
    );
    await context.setOffline(true);
    await registerOffline(page, "Padaria Offline", "4790");
    await context.setOffline(false);
    await expect(indicator(page, "Entre de novo para enviar 1 lançamento")).toBeVisible({
      timeout: 30_000,
    });

    // The session is gone: the next screen sends to the login, and the entry is still waiting.
    await context.clearCookies();
    await page.unroute("**/api/sync");
    await page.getByRole("link", { name: "Lançamentos", exact: true }).click();
    await expect(page).toHaveURL(/\/entrar/);
    expect(await queued(page)).toBe(1);

    await signIn(page, email);
    await expect(page.getByText("1 lançamento sincronizado")).toBeVisible({ timeout: 30_000 });
    await expect(indicator(page, /Entre de novo|aguardando sincronização/)).toBeHidden();
    await open(page, "Lançamentos");
    await expect(row(page, isMobile, "Padaria Offline")).toHaveCount(1);
  });

  test("com rede, se o envio falha o lançamento vai para a fila e é criado uma vez só", async ({
    page,
    isMobile,
  }) => {
    test.slow();
    await setup(page);
    // The Server Action's request dies on the way; the queue's endpoint works.
    await page.route("**/registrar", (route) =>
      route.request().method() === "POST" && route.request().headers()["next-action"]
        ? route.abort()
        : route.continue(),
    );
    await typeAmount(page, "4790");
    await page.getByLabel("O que foi?").fill("Padaria Offline");
    await save(page).click();

    const toast = page.getByRole("listitem").filter({ hasText: "salva no aparelho" });
    await expect(toast).toContainText("O envio não respondeu.");
    // The first request may still arrive: nothing here can promise an undo.
    await expect(toast.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
    await expect(page.getByText("1 lançamento sincronizado")).toBeVisible({ timeout: 30_000 });
    await page.unroute("**/registrar");

    await open(page, "Lançamentos");
    await expect(row(page, isMobile, "Padaria Offline")).toHaveCount(1);
  });
});

test("/api/sync sem sessão responde 401, sem redirecionar para o login", async ({
  request,
  baseURL,
}) => {
  const response = await request.post("/api/sync", {
    headers: { origin: baseURL! },
    data: { items: [{ clientId: "x", kind: "ENTRY", data: {} }] },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
});
