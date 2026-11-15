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

export async function signUp(page: Page, { name = "Ana Teste", email = uniqueEmail() } = {}) {
  await page.goto("/cadastro");
  await waitForHydratedForm(page);
  await page.getByLabel("Nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  // Creating the account hashes the password: under a full parallel run it can take a while.
  await expect(page.getByRole("heading", { name: `Olá, ${name}` })).toBeVisible({
    timeout: 15_000,
  });
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
