import { expect, type Page, test } from "@playwright/test";

import { signUp } from "./helpers";

async function typeAmount(page: Page, digits: string) {
  const keypad = page.getByRole("group", { name: "Teclado numérico" });
  for (const digit of digits) {
    await keypad.getByRole("button", { name: digit, exact: true }).click();
  }
}

async function open(page: Page, name: "Contas" | "Registrar") {
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(name === "Contas" ? /\/contas$/ : /\/registrar$/);
}

test("registra uma assinatura e o Desfazer apaga a cobrança e a regra", async ({ page }) => {
  test.slow();
  await signUp(page);
  await page.goto("/contas");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill("Banco Azul");
  await dialog.getByLabel("Saldo inicial em reais").fill("1.000,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();

  await open(page, "Registrar");
  await typeAmount(page, "3990");
  await page.getByLabel("O que foi?").fill("Streaming");
  await page.getByLabel("O que foi?").press("Enter");
  await page.getByLabel("Assinatura").click();
  await expect(page.getByText(/^Repete todo dia \d+/)).toBeVisible();

  // "Parcelado" only shows on credit; "Receita" hides "Assinatura".
  await page.getByRole("group", { name: "Tipo" }).getByRole("button", { name: "Receita" }).click();
  await expect(page.getByLabel("Assinatura")).toHaveCount(0);
  await page.getByRole("group", { name: "Tipo" }).getByRole("button", { name: "Despesa" }).click();
  await expect(page.getByLabel("Assinatura")).not.toBeChecked();
  await page.getByLabel("Assinatura").click();

  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText("Assinatura de R$ 39,90 salva")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();

  await open(page, "Contas");
  const azul = page
    .getByRole("list", { name: "Contas" })
    .getByRole("listitem")
    .filter({ hasText: "Banco Azul" });
  await expect(azul).toContainText("Saldo atual R$ 960,10");

  const toastItem = page.getByRole("listitem").filter({ hasText: "Assinatura de R$ 39,90 salva" });
  await toastItem.hover();
  await toastItem.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByText("Lançamento desfeito.")).toBeVisible();
  await expect(azul).toContainText("Saldo atual R$ 1.000,00");
});
