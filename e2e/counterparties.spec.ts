import { expect, type Page, test } from "@playwright/test";

import { signUp } from "./helpers";

async function createAccount(page: Page) {
  await page.goto("/contas");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill("Banco Azul");
  await dialog.getByLabel("Saldo inicial em reais").fill("0");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
}

async function typeAmount(page: Page, digits: string) {
  const keypad = page.getByRole("group", { name: "Teclado numérico" });
  for (const digit of digits) {
    await keypad.getByRole("button", { name: digit, exact: true }).click();
  }
}

/** Saves and waits for the home page (see e2e/register.spec.ts on navigating via links). */
async function save(page: Page, message: string) {
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText(message)).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();
}

async function openRegister(page: Page) {
  await page.getByRole("link", { name: "Registrar", exact: true }).click();
  await expect(page).toHaveURL(/\/registrar$/);
}

const suggestions = (page: Page) => page.getByRole("listbox", { name: "Sugestões" });

test("escolher uma sugestão preenche o estabelecimento e a categoria", async ({ page }) => {
  test.slow(); // three saves on the dev server
  await signUp(page);
  await createAccount(page);

  await page.goto("/registrar");
  await typeAmount(page, "2550");
  await page.getByLabel("O que foi?").fill("Padaria do Bairro");
  await page.getByLabel("O que foi?").press("Enter");
  const categories = page.getByRole("group", { name: "Categoria" });
  await categories.getByRole("button", { name: "Alimentação" }).click();
  await save(page, "Despesa de R$ 25,50 salva");

  // CA3: "pada" sugere; escolher preenche o nome e a categoria.
  await openRegister(page);
  await typeAmount(page, "1000");
  const what = page.getByLabel("O que foi?");
  await what.fill("pada");
  const option = suggestions(page).getByRole("option", { name: /Padaria do Bairro/ });
  await expect(option).toBeVisible();
  await option.click();
  await expect(what).toHaveValue("Padaria do Bairro");
  await expect(what).not.toBeFocused();
  await expect(categories.getByRole("button", { name: "Alimentação" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await save(page, "Despesa de R$ 10,00 salva");

  // Same counterparty: still one suggestion; and with the keyboard (↓, Enter) too.
  await openRegister(page);
  await what.fill("PADARIA");
  await expect(suggestions(page).getByRole("option")).toHaveCount(1);
  await what.press("ArrowDown");
  await what.press("Enter");
  await expect(what).toHaveValue("Padaria do Bairro");
});

test("guarda o nome no extrato e o CNPJ, e acha por eles", async ({ page }) => {
  test.slow();
  await signUp(page);
  await createAccount(page);

  await page.goto("/registrar");
  await typeAmount(page, "1500");
  await page.getByLabel("O que foi?").fill("Feira da Praça");
  await page.getByLabel("O que foi?").press("Enter");
  await page.getByRole("button", { name: "Mais detalhes" }).click();
  await page.getByLabel("Nome no extrato").fill("PAG*JOSE SILVA");

  // CA4 na tela: um CNPJ inválido é recusado com a mensagem do validador.
  await page.getByLabel("CPF/CNPJ").fill("11.222.333/0001-80");
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText("CNPJ inválido. Confira os caracteres.")).toBeVisible();

  await page.getByLabel("CPF/CNPJ").fill("11.222.333/0001-81");
  await save(page, "Despesa de R$ 15,00 salva");

  // CA7: "jose" acha pelo nome no extrato, mostrando onde casou.
  await openRegister(page);
  const what = page.getByLabel("O que foi?");
  await what.fill("jose");
  await expect(suggestions(page).getByRole("option")).toHaveText([
    /Feira da Praça.*no extrato: PAG\*JOSE SILVA/,
  ]);

  // Parte do CNPJ, sem pontuação.
  await what.fill("222333");
  await expect(suggestions(page).getByRole("option")).toHaveText([
    /Feira da Praça.*CPF\/CNPJ: 11\.222\.333\/0001-81/,
  ]);
});
