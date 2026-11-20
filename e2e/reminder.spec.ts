import { expect, test } from "@playwright/test";

import { signUp } from "./helpers";

// The service worker (and so push) only exists in production builds (task 15).
const production = !!process.env.CI;

test("a seção Lembrete diário diz quando e por que não dá para ligar", async ({
  page,
  browserName,
}) => {
  await signUp(page);
  await page.goto("/configuracoes");
  const section = page.getByRole("region", { name: "Lembrete diário" });
  const toggle = section.getByRole("switch", { name: "Lembrar às 21h neste aparelho" });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();

  if (!production) {
    await expect(section.getByText("Lembretes indisponíveis neste ambiente.")).toBeVisible();
    await expect(toggle).toBeDisabled();
    return;
  }
  if (browserName === "webkit") {
    // The iPhone profile, in Safari, not installed: push needs the app on the home screen.
    await expect(
      section.getByText("No iPhone, o lembrete só funciona com o app instalado na Tela de Início."),
    ).toBeVisible();
    await expect(toggle).toBeDisabled();
    return;
  }
  // Playwright's headless Chromium has no notifications (permission "denied", even when granted):
  // the blocked case. The ready one is covered by src/lib/reminder-availability.test.ts.
  await expect(
    section.getByText("As notificações estão bloqueadas. Libere nas configurações do navegador."),
  ).toBeVisible();
  await expect(toggle).toBeDisabled();
});

test("a rota do cron recusa chamadas sem o segredo", async ({ request }) => {
  const response = await request.get("/api/cron/daily", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
  const wrong = await request.get("/api/cron/daily", {
    maxRedirects: 0,
    headers: { authorization: "Bearer errado" },
  });
  expect(wrong.status()).toBe(401);
});
