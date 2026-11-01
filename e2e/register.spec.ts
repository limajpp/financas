import { expect, type Page, test } from "@playwright/test";

import { formatCalendarDate, todayInSaoPaulo } from "../src/domain/dates";
import { invoiceFor } from "../src/domain/invoice-cycle";
import { signUp } from "./helpers";

async function createAccount(page: Page, name: string, balance: string) {
  await page.goto("/contas");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill(name);
  await dialog.getByLabel("Saldo inicial em reais").fill(balance);
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
}

/** Types an amount on the screen's keypad, digit by digit ("4790" → R$ 47,90). */
async function typeAmount(page: Page, digits: string) {
  const keypad = page.getByRole("group", { name: "Teclado numérico" });
  for (const digit of digits) {
    await keypad.getByRole("button", { name: digit, exact: true }).click();
  }
}

/**
 * Opens a section through the navigation links, as a person would. A page.goto() right after a
 * client navigation can abort its still-streaming response, which WebKit turns into a full reload.
 */
async function open(page: Page, name: "Contas" | "Registrar") {
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(name === "Contas" ? /\/contas$/ : /\/registrar$/);
}

async function currentBalance(page: Page, account: string) {
  await open(page, "Contas");
  return page
    .getByRole("list", { name: "Contas" })
    .getByRole("listitem")
    .filter({ hasText: account });
}

/** After saving, the screen goes back home with the confirmation. */
async function savedHome(page: Page, message: string) {
  await expect(page.getByText(message)).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();
}

const payment = (page: Page) => page.getByRole("button", { name: /^Forma de pagamento:/ });

test("registra uma despesa só com o valor, com uma categoria, e desfaz", async ({ page }) => {
  await signUp(page);
  await createAccount(page, "Banco Azul", "1.000,00");

  // CA1: só o valor.
  await page.goto("/registrar");
  const save = page.getByRole("button", { name: /^Salvar/ });
  await expect(save).toBeDisabled();
  await typeAmount(page, "4790");
  await expect(page.getByRole("status", { name: "Valor" })).toHaveText("R$ 47,90");
  await save.click();
  await savedHome(page, "Despesa de R$ 47,90 salva");
  await expect(await currentBalance(page, "Banco Azul")).toContainText("Saldo atual R$ 952,10");

  // CA3: valor + categoria + Salvar (2 toques além do valor), e a categoria fica gravada:
  // na próxima abertura, ela é a mais usada.
  await open(page, "Registrar");
  const categories = page.getByRole("group", { name: "Categoria" });
  await expect(categories.getByRole("button").first()).toHaveText("Moradia");
  await typeAmount(page, "1250");
  await categories.getByRole("button", { name: "Alimentação" }).click();
  await save.click();
  await savedHome(page, "Despesa de R$ 12,50 salva");
  await open(page, "Registrar");
  await expect(categories.getByRole("button").first()).toHaveText("Alimentação");
  // The screen comes back blank (Next keeps the route alive between visits).
  await expect(page.getByRole("status", { name: "Valor" })).toHaveText("R$ 0,00");
  await expect(categories.getByRole("button", { pressed: true })).toHaveCount(0);

  // CA6: "Desfazer" exclui, e o saldo volta.
  await typeAmount(page, "10000");
  await save.click();
  await savedHome(page, "Despesa de R$ 100,00 salva");
  await page
    .getByRole("listitem")
    .filter({ hasText: "Despesa de R$ 100,00 salva" })
    .getByRole("button", { name: "Desfazer" })
    .click();
  await expect(page.getByText("Lançamento desfeito.")).toBeVisible();
  await expect(await currentBalance(page, "Banco Azul")).toContainText("Saldo atual R$ 939,60");
});

test("lembra a última conta e forma de pagamento", async ({ page }) => {
  await signUp(page);
  await createAccount(page, "Banco Azul", "0");
  await createAccount(page, "Banco Inter", "0");

  await page.goto("/registrar");
  await expect(payment(page)).toHaveText("Banco Azul · Pix");
  await payment(page).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Débito" }).click();
  await sheet.getByRole("button", { name: "Banco Inter" }).click();
  await expect(sheet).toBeHidden();
  await expect(payment(page)).toHaveText("Banco Inter · Débito");
  await typeAmount(page, "500");
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await savedHome(page, "Despesa de R$ 5,00 salva");

  // CA2: a próxima abertura vem com Inter/Débito.
  await open(page, "Registrar");
  await expect(payment(page)).toHaveText("Banco Inter · Débito");

  // A receita lembra à parte e nunca começa no débito.
  await page.getByRole("button", { name: "Receita" }).click();
  await expect(payment(page)).toHaveText("Banco Azul · Pix");
});

test("compra no crédito mostra a fatura e não mexe no saldo", async ({ page }) => {
  await signUp(page);
  await createAccount(page, "Banco Azul", "1.000,00");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Novo cartão" }).click();
  await dialog.getByLabel("Nome").fill("Cartão Roxo");
  await dialog.getByLabel("Fecha dia").selectOption("3");
  await dialog.getByLabel("Vence dia").selectOption("10");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();

  await page.goto("/registrar");
  await payment(page).click();
  await dialog.getByRole("button", { name: "Crédito" }).click();
  await dialog.getByRole("button", { name: "Cartão Roxo" }).click();
  await expect(payment(page)).toHaveText("Cartão Roxo · Crédito");

  // CA5: a fatura calculada pelo ciclo do cartão.
  const due = invoiceFor({ closingDay: 3, dueDay: 10 }, todayInSaoPaulo()).dueDate;
  const invoice = page.getByLabel("Cai na fatura que vence em");
  await expect(invoice).toHaveValue(due);
  await expect(invoice.locator("option:checked")).toHaveText(
    `${formatCalendarDate(due)} (calculada)`,
  );

  await typeAmount(page, "30000");
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await savedHome(page, "Despesa de R$ 300,00 salva");
  await expect(await currentBalance(page, "Banco Azul")).toContainText("Saldo atual R$ 1.000,00");
});

test("sem conta, pede uma conta; em 375 px, não rola na horizontal", async ({ page }) => {
  await signUp(page);
  await page.goto("/registrar");
  await expect(page.getByText("Cadastre uma conta para começar a registrar.")).toBeVisible();

  await createAccount(page, "Banco com um nome bem comprido demais", "0");
  // CA4: largura de iPhone SE/mini.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/registrar");
  await expect(payment(page)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
