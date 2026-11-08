import { expect, type Page, test } from "@playwright/test";

import { signUp } from "./helpers";

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
async function open(page: Page, name: "Contas" | "Registrar") {
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(name === "Contas" ? /\/contas$/ : /\/registrar$/);
}

const accountRow = (page: Page, name: string) =>
  page.getByRole("list", { name: "Contas" }).getByRole("listitem").filter({ hasText: name });

test("transfere entre contas pelo registro", async ({ page }) => {
  test.slow();
  await signUp(page);
  await page.goto("/contas");
  await createAccount(page, "Banco Azul", "1.000,00");
  await createAccount(page, "Banco Verde", "0");

  await open(page, "Registrar");
  await page
    .getByRole("group", { name: "Tipo" })
    .getByRole("button", { name: "Transferência" })
    .click();
  await expect(page.getByLabel("De", { exact: true })).toHaveValue(/.+/);
  await expect(page.getByLabel("De", { exact: true }).locator("option:checked")).toHaveText(
    "Banco Azul",
  );
  await expect(page.getByLabel("Para", { exact: true }).locator("option:checked")).toHaveText(
    "Banco Verde",
  );
  // No category or "O que foi?" on a transfer.
  await expect(page.getByRole("group", { name: "Categoria" })).toHaveCount(0);

  await typeAmount(page, "50000");
  const save = page.getByRole("button", { name: "Salvar transferência" });

  // Same account on both sides: refused before saving.
  await page.getByLabel("Para", { exact: true }).selectOption({ label: "Banco Azul" });
  await expect(page.getByText("Escolha contas diferentes.")).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByLabel("Para", { exact: true }).selectOption({ label: "Banco Verde" });

  await save.click();
  await expect(page.getByText("Transferência de R$ 500,00 salva")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();

  await open(page, "Contas");
  await expect(accountRow(page, "Banco Azul")).toContainText("Saldo atual R$ 500,00");
  await expect(accountRow(page, "Banco Verde")).toContainText("Saldo atual R$ 500,00");
});

test("paga a fatura com o total já preenchido", async ({ page }) => {
  test.slow();
  await signUp(page);
  await page.goto("/contas");
  await createAccount(page, "Banco Azul", "1.000,00");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Novo cartão" }).click();
  await dialog.getByLabel("Nome").fill("Cartão Roxo");
  await dialog.getByLabel("Fecha dia").selectOption("3");
  await dialog.getByLabel("Vence dia").selectOption("10");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();

  // A credit purchase of R$ 300,00: it doesn't touch the balance.
  await open(page, "Registrar");
  await page.getByRole("button", { name: /^Forma de pagamento:/ }).click();
  await dialog.getByRole("button", { name: "Crédito" }).click();
  await dialog.getByRole("button", { name: "Cartão Roxo" }).click();
  await typeAmount(page, "30000");
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();

  await open(page, "Contas");
  await expect(accountRow(page, "Banco Azul")).toContainText("Saldo atual R$ 1.000,00");

  await page.getByRole("button", { name: "Pagar fatura Cartão Roxo" }).click();
  await expect(dialog.getByLabel("Fatura (vencimento)").locator("option:checked")).toContainText(
    "(aberta) · R$ 300,00 a pagar",
  );
  await expect(dialog.getByLabel("Valor pago em reais")).toHaveValue("300,00");
  await expect(dialog.getByLabel("Conta que paga").locator("option:checked")).toHaveText(
    "Banco Azul",
  );
  await dialog.getByRole("button", { name: "Salvar pagamento" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Pagamento de R$ 300,00 salvo")).toBeVisible();
  await expect(accountRow(page, "Banco Azul")).toContainText("Saldo atual R$ 700,00");

  // Paid: the invoice shows nothing left.
  await page.getByRole("button", { name: "Pagar fatura Cartão Roxo" }).click();
  await expect(dialog.getByLabel("Fatura (vencimento)").locator("option:checked")).toContainText(
    "R$ 0,00 a pagar",
  );
});
