import { expect, type Page, test } from "@playwright/test";

import { formatCalendarDate, todayInSaoPaulo } from "../src/domain/dates";
import { signUp } from "./helpers";

/**
 * page.goto that survives Next's fallback: home shows before its data request ends, a goto then
 * aborts that request, and Next answers with a full load of "/" that interrupts the goto (WebKit).
 */
async function visit(page: Page, url: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(url);
      return;
    } catch (error) {
      if (attempt >= 3 || !String(error).includes("interrupted by another navigation")) throw error;
    }
  }
}

/** "Banco Azul" with R$ 1.000,00 and a R$ 100,00 expense on it. */
async function setup(page: Page) {
  await signUp(page);
  await visit(page, "/contas");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill("Banco Azul");
  await dialog.getByLabel("Saldo inicial em reais").fill("1.000,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("link", { name: "Registrar", exact: true }).click();
  await expect(page).toHaveURL(/\/registrar$/);
  const keypad = page.getByRole("group", { name: "Teclado numérico" });
  for (const digit of "10000")
    await keypad.getByRole("button", { name: digit, exact: true }).click();
  await page.getByLabel("O que foi?").fill("Mercado Central");
  await page.getByLabel("O que foi?").press("Escape");
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText("Despesa de R$ 100,00 salva")).toBeVisible();
  await expect(page).toHaveURL(/:\d+\/$/);
}

const azul = (page: Page) =>
  page
    .getByRole("list", { name: "Contas" })
    .getByRole("listitem")
    .filter({ hasText: "Banco Azul" });

async function compare(page: Page, bank: string) {
  await visit(page, "/contas");
  await expect(azul(page)).toContainText("Nunca conferido");
  await page.getByRole("button", { name: "Conferir saldo Banco Azul" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Saldo no app do banco hoje em reais").fill(bank);
  await dialog.getByRole("button", { name: "Comparar" }).click();
  return dialog;
}

test("CA5: com diferença, o ajuste deixa o saldo igual ao do banco e marca a conferência", async ({
  page,
}) => {
  test.slow();
  await setup(page);
  const dialog = await compare(page, "850,00");
  await expect(dialog).toContainText("No app");
  await expect(dialog).toContainText("R$ 900,00");
  await expect(dialog.getByRole("status")).toHaveText(
    "Faltam R$ 50,00 em saídas: um gasto que não foi registrado?",
  );
  await expect(dialog.getByRole("list")).toContainText("Mercado Central");

  await dialog.getByRole("button", { name: "Criar ajuste de R$ 50,00" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Ajuste de R$ 50,00 criado")).toBeVisible();
  await expect(azul(page)).toContainText("Saldo atual R$ 850,00");
  await expect(azul(page)).toContainText(`Conferido em ${formatCalendarDate(todayInSaoPaulo())}`);

  // Comparing again now matches.
  await page.getByRole("button", { name: "Conferir saldo Banco Azul" }).click();
  await dialog.getByLabel("Saldo no app do banco hoje em reais").fill("850,00");
  await dialog.getByRole("button", { name: "Comparar" }).click();
  await expect(dialog.getByRole("status")).toHaveText("O saldo bate com o banco.");
  await dialog.getByRole("button", { name: "Marcar como conferido" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Conta conferida")).toBeVisible();
});

test("CA5: registrar o que falta abre o registro com o valor e o tipo", async ({ page }) => {
  test.slow();
  await setup(page);
  const dialog = await compare(page, "1.020,00");
  await expect(dialog.getByRole("status")).toHaveText(
    "Faltam R$ 120,00 em entradas: um recebimento que não foi registrado?",
  );
  await dialog.getByRole("link", { name: "Registrar o que falta" }).click();
  await expect(page).toHaveURL(/\/registrar$/);
  await expect(
    page.getByRole("group", { name: "Tipo" }).getByRole("button", { name: "Receita" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('output[aria-label="Valor"]')).toContainText("R$ 120,00");
  await expect(page.getByRole("button", { name: /^Forma de pagamento:/ })).toContainText(
    "Banco Azul · Pix",
  );
});

test("um saldo negativo no banco vira um ajuste de saída", async ({ page }) => {
  test.slow();
  await setup(page);
  const dialog = await compare(page, "10,00");
  await expect(dialog.getByRole("status")).toContainText("Faltam R$ 890,00 em saídas");
  await dialog.getByRole("button", { name: "Voltar" }).click();
  await dialog.getByLabel("Saldo negativo (cheque especial)").check();
  await dialog.getByRole("button", { name: "Comparar" }).click();
  await expect(dialog).toContainText("-R$ 10,00");
  await expect(dialog.getByRole("status")).toContainText("Faltam R$ 910,00 em saídas");
});
