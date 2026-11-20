import { expect, type Page, test } from "@playwright/test";

import { signUp, visit } from "./helpers";

async function createAccount(page: Page, name: string) {
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill(name);
  await dialog.getByLabel("Saldo inicial em reais").fill("1.000,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
}

test("CA4: 'Pular para o conteúdo' é o primeiro Tab e leva ao conteúdo", async ({
  page,
  isMobile,
}) => {
  // Safari on the iPhone has no Tab key to move between links.
  test.skip(isMobile, "sem teclado no iPhone");
  await signUp(page);
  await visit(page, "/lancamentos");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Pular para o conteúdo" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#conteudo")).toBeFocused();
});

test("CA4: arquivar deixa o foco no título, e não no topo da página", async ({ page }) => {
  await signUp(page);
  await visit(page, "/contas");
  await createAccount(page, "Banco Azul");
  await createAccount(page, "Banco Verde");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Novo cartão" }).click();
  await dialog.getByLabel("Nome").fill("Cartão Roxo");
  await dialog.getByLabel("Fecha dia").selectOption("3");
  await dialog.getByLabel("Vence dia").selectOption("10");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Arquivar Banco Verde" }).click();
  await expect(page.getByRole("button", { name: "Arquivar Banco Verde" })).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Contas" })).toBeFocused();

  await page.getByRole("button", { name: "Arquivar Cartão Roxo" }).click();
  await expect(page.getByRole("button", { name: "Arquivar Cartão Roxo" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Cartões de crédito" })).toBeFocused();
});

test("CA4: a conferência anuncia o resultado numa região que já existia", async ({ page }) => {
  await signUp(page);
  await visit(page, "/contas");
  await createAccount(page, "Banco Azul");
  await page.getByRole("button", { name: "Conferir saldo Banco Azul" }).click();
  const dialog = page.getByRole("dialog");
  const status = dialog.getByRole("status");
  // Empty while the balance is typed: some screen readers only read a region that changes.
  await expect(status).toHaveText("");
  const region = await status.elementHandle();
  await dialog.getByLabel("Saldo no app do banco hoje em reais").fill("1.000,00");
  await dialog.getByRole("button", { name: "Comparar" }).click();
  await expect(status).toHaveText("O saldo bate com o banco.");
  // The same element: it changed, it wasn't born with the text.
  expect(await region!.evaluate((node) => node.isConnected)).toBe(true);
  expect(await region!.textContent()).toBe("O saldo bate com o banco.");
});
