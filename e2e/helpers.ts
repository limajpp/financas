import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

export const PASSWORD = "senha-de-teste-123";

export function uniqueEmail() {
  return `e2e+${randomUUID()}@example.com`;
}

export async function signUp(page: Page, { name = "Ana Teste", email = uniqueEmail() } = {}) {
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: `Olá, ${name}` })).toBeVisible();
  return { name, email };
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
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
