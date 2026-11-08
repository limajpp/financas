import { expect, type Page, test } from "@playwright/test";

import { signUp } from "./helpers";

async function setup(page: Page) {
  await signUp(page);
  await page.goto("/contas");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill("Banco Azul");
  await dialog.getByLabel("Saldo inicial em reais").fill("1.000,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Novo cartão" }).click();
  await dialog.getByLabel("Nome").fill("Cartão Roxo");
  await dialog.getByLabel("Fecha dia").selectOption("3");
  await dialog.getByLabel("Vence dia").selectOption("10");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
}

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

/** R$ 300,00 in 3× on the card, from the register screen. */
async function buyInInstallments(page: Page) {
  await open(page, "Registrar");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: /^Forma de pagamento:/ }).click();
  await dialog.getByRole("button", { name: "Crédito" }).click();
  await dialog.getByRole("button", { name: "Cartão Roxo" }).click();
  await typeAmount(page, "30000");
  await page.getByLabel("Parcelado").click();
  await page.getByLabel("Número de parcelas").selectOption("3");
  await expect(page.getByText("3× de R$ 100,00")).toBeVisible();
  await expect(page.getByText(/^1ª parcela na fatura que vence em/)).toBeVisible();
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText("Despesa de R$ 300,00 em 3× salva")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();
}

test("registra uma compra em 3× e cada parcela cai numa fatura", async ({ page }) => {
  test.slow();
  await setup(page);
  await buyInInstallments(page);

  await open(page, "Contas");
  const azul = page
    .getByRole("list", { name: "Contas" })
    .getByRole("listitem")
    .filter({ hasText: "Banco Azul" });
  await expect(azul).toContainText("Saldo atual R$ 1.000,00");

  await page.getByRole("button", { name: "Pagar fatura Cartão Roxo" }).click();
  const invoices = page.getByRole("dialog").getByLabel("Fatura (vencimento)");
  await expect(invoices.locator("option:checked")).toContainText("(aberta) · R$ 100,00 a pagar");
  await expect(invoices.locator("option", { hasText: "(futura) · R$ 100,00 a pagar" })).toHaveCount(
    2,
  );
});

test("o Desfazer apaga todas as parcelas", async ({ page }) => {
  test.slow();
  await setup(page);
  await buyInInstallments(page);

  const toastItem = page
    .getByRole("listitem")
    .filter({ hasText: "Despesa de R$ 300,00 em 3× salva" });
  await toastItem.hover();
  await toastItem.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByText("Lançamento desfeito.")).toBeVisible();

  await open(page, "Contas");
  await page.getByRole("button", { name: "Pagar fatura Cartão Roxo" }).click();
  const invoices = page.getByRole("dialog").getByLabel("Fatura (vencimento)");
  await expect(invoices.locator("option")).toHaveCount(1);
  await expect(invoices.locator("option:checked")).toContainText("(aberta) · R$ 0,00 a pagar");
});
