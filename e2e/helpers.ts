import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

export const PASSWORD = "senha-de-teste-123";

export function uniqueEmail() {
  return `e2e+${randomUUID()}@example.com`;
}

/**
 * Waits until React has hydrated the page's form. The auth forms submit from the client: a click
 * before that is a native submit, which only reloads the page with the fields empty (seen under
 * load, right after the full reload of "Sair").
 */
export async function waitForHydratedForm(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("main form");
    return !!form && Object.keys(form).some((key) => key.startsWith("__reactProps"));
  });
}

/** Creates an account; it lands on home, unless `onboarding` keeps it on the onboarding. */
export async function signUp(
  page: Page,
  { name = "Ana Teste", email = uniqueEmail(), onboarding = false } = {},
) {
  await page.goto("/cadastro");
  await waitForHydratedForm(page);
  await page.getByLabel("Nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  // Creating the account hashes the password: under a full parallel run it can take a while.
  // A new account starts with the onboarding (task 22); the tests skip it.
  await expect(page.getByRole("heading", { name: "Contas" })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/comecar$/);
  if (onboarding) return { name, email };
  await page.getByRole("link", { name: "Pular por agora" }).click();
  await expect(page.getByRole("heading", { name: `Olá, ${name}` })).toBeVisible();
  return { name, email };
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await waitForHydratedForm(page);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

export async function signOut(page: Page, isMobile: boolean) {
  // Mobile keeps "Sair" in the settings page; desktop has it in the sidebar.
  if (isMobile) await page.goto("/configuracoes");
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
}

/** The form's error message. Scoped to <main>: Next's route announcer is also role="alert". */
export function formAlert(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

/**
 * page.goto that survives Next's fallback: a page shows before its data request ends, a goto then
 * aborts that request, and Next answers with a full load of "/" that interrupts the goto (WebKit).
 */
export async function visit(page: Page, url: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(url);
      return;
    } catch (error) {
      if (attempt >= 3 || !String(error).includes("interrupted by another navigation")) throw error;
    }
  }
}

/**
 * Home is on screen, once. For a frame the Next router keeps the previous route alive and two
 * home headings can coexist (task 26): the first one is waited for, then exactly one must remain,
 * so a duplicate that stays on screen still fails.
 */
export async function expectHome(page: Page) {
  const heading = page.getByRole("heading", { name: /^Olá/ });
  await expect(heading.first()).toBeVisible();
  await expect(heading).toHaveCount(1);
}
