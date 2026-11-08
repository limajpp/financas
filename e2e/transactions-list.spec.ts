import { expect, type Page, test } from "@playwright/test";

import { signUp } from "./helpers";

async function createAccount(page: Page, name: string) {
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill(name);
  await dialog.getByLabel("Saldo inicial em reais").fill("1.000,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
}

async function createCard(page: Page) {
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Novo cartão" }).click();
  await dialog.getByLabel("Nome").fill("Cartão Roxo");
  await dialog.getByLabel("Fecha dia").selectOption("3");
  await dialog.getByLabel("Vence dia").selectOption("10");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
}

async function open(page: Page, name: "Contas" | "Registrar" | "Lançamentos") {
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(
    name === "Contas" ? /\/contas$/ : name === "Registrar" ? /\/registrar$/ : /\/lancamentos/,
  );
}

/** Registers an expense from the register screen. */
async function register(
  page: Page,
  what: string,
  digits: string,
  {
    place,
    credit = false,
    date,
    installments,
  }: { place: string; credit?: boolean; date?: string; installments?: string },
) {
  await open(page, "Registrar");
  const sheet = page.getByRole("dialog");
  await page.getByRole("button", { name: /^Forma de pagamento:/ }).click();
  await sheet.getByRole("button", { name: credit ? "Crédito" : "Pix" }).click();
  await sheet.getByRole("button", { name: place, exact: true }).click();
  await expect(sheet).toBeHidden();
  const keypad = page.getByRole("group", { name: "Teclado numérico" });
  for (const digit of digits)
    await keypad.getByRole("button", { name: digit, exact: true }).click();
  await page.getByLabel("O que foi?").fill(what);
  await page.getByLabel("O que foi?").press("Enter");
  if (date) await page.getByLabel("Data", { exact: true }).fill(date);
  if (installments) {
    await page.getByLabel("Parcelado").click();
    await page.getByLabel("Número de parcelas").selectOption(installments);
  }
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText(/salva$/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();
}

/** The first day of last month, "YYYY-MM-DD", in São Paulo. */
function lastMonthStart() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
  const [y, m] = today.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) - 1;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** A filter select: inline on the computer, in the "Filtros" sheet on the phone. */
async function chooseFilter(page: Page, isMobile: boolean, label: string, option: string) {
  if (isMobile) {
    await page.getByRole("button", { name: /^Filtros/ }).click();
    await page
      .getByRole("dialog")
      .getByLabel(label, { exact: true })
      .selectOption({ label: option });
    await page.keyboard.press("Escape");
  } else {
    await page.getByLabel(label, { exact: true }).selectOption({ label: option });
  }
}

/** The row of an entry, on the phone (list) or the computer (table). */
const row = (page: Page, isMobile: boolean, text: string) =>
  isMobile
    ? page.getByRole("listitem").filter({ hasText: text })
    : page.getByRole("row").filter({ hasText: text });

test("filtra por conta e período, com os filtros na URL; parcelas aparecem como 1/3", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(240_000); // entries registered through the screen, on the dev server
  await signUp(page);
  await page.goto("/contas");
  await createAccount(page, "Banco Azul");
  await createAccount(page, "Banco Verde");
  await createCard(page);

  await register(page, "Mercado Alfa", "1000", { place: "Banco Azul" });
  await register(page, "Mercado Beta", "2000", { place: "Banco Verde" });
  await register(page, "Mercado Gama", "3000", { place: "Banco Azul", date: lastMonthStart() });
  await register(page, "Loja de Móveis", "30000", {
    place: "Cartão Roxo",
    credit: true,
    installments: "3",
  });

  await open(page, "Lançamentos");
  await expect(row(page, isMobile, "Mercado Alfa")).toBeVisible();
  await expect(row(page, isMobile, "Mercado Beta")).toBeVisible();
  await expect(row(page, isMobile, "Mercado Gama")).toHaveCount(0);
  // CA3
  await expect(row(page, isMobile, "Loja de Móveis")).toContainText("Cartão Roxo · 1/3");

  // CA1: account + period.
  await chooseFilter(page, isMobile, "Conta", "Banco Azul");
  await expect(page).toHaveURL(/conta=/);
  await expect(row(page, isMobile, "Mercado Beta")).toHaveCount(0);
  await expect(row(page, isMobile, "Mercado Alfa")).toBeVisible();
  await page.getByRole("button", { name: "Mês anterior" }).click();
  await expect(page).toHaveURL(new RegExp(`de=${lastMonthStart()}`));
  await expect(row(page, isMobile, "Mercado Gama")).toBeVisible();
  await expect(row(page, isMobile, "Mercado Alfa")).toHaveCount(0);

  await page.reload();
  await expect(row(page, isMobile, "Mercado Gama")).toBeVisible();
  await expect(row(page, isMobile, "Mercado Alfa")).toHaveCount(0);
});

test("categoriza 3 de uma vez, edita, exclui e edita parcelas com escopo", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(240_000); // entries registered through the screen, on the dev server
  await signUp(page);
  await page.goto("/contas");
  await createAccount(page, "Banco Azul");
  await createCard(page);
  for (const [what, digits] of [
    ["Feira Um", "1000"],
    ["Feira Dois", "2000"],
    ["Feira Três", "3000"],
  ] as const) {
    await register(page, what, digits, { place: "Banco Azul" });
  }
  await register(page, "Sofá Novo", "30000", {
    place: "Cartão Roxo",
    credit: true,
    installments: "3",
  });

  await open(page, "Lançamentos");
  // CA2: select 3 and set "Mercado".
  if (isMobile) await page.getByRole("button", { name: "Selecionar", exact: true }).click();
  for (const what of ["Feira Um", "Feira Dois", "Feira Três"]) {
    await page.getByRole(isMobile ? "button" : "checkbox", { name: `Selecionar ${what}` }).click();
  }
  const bulk = page.getByRole("region", { name: "Ações em massa" });
  await expect(bulk).toContainText("3 selecionados");
  await bulk.getByLabel("Nova categoria").selectOption({ label: "Mercado" });
  await bulk.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("3 lançamentos categorizados")).toBeVisible();

  // CA7: edit the amount of one.
  const dialog = page.getByRole("dialog");
  await row(page, isMobile, "Feira Um").getByRole("button").first().click();
  await expect(dialog.getByLabel("Categoria").locator("option:checked")).toHaveText("Mercado");
  await dialog.getByLabel("Valor").fill("15,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Lançamento atualizado")).toBeVisible();
  await expect(row(page, isMobile, "Feira Um")).toContainText("15,00");

  // Delete one, with confirmation.
  await row(page, isMobile, "Feira Dois").getByRole("button").first().click();
  await dialog.getByRole("button", { name: "Excluir" }).click();
  await expect(dialog.getByText("Excluir este lançamento?")).toBeVisible();
  await dialog.getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByText("Lançamento excluído")).toBeVisible();
  await expect(row(page, isMobile, "Feira Dois")).toHaveCount(0);

  // Installment: "Esta e as próximas" changes the next months too.
  await row(page, isMobile, "Sofá Novo").getByRole("button").first().click();
  await expect(dialog.getByText(/Parcela 1 de 3/)).toBeVisible();
  await dialog.getByLabel("Observação").fill("Sala");
  await dialog.getByLabel("Esta e as próximas").check();
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Lançamento atualizado")).toBeVisible();
  await page.getByRole("button", { name: "Próximo mês" }).click();
  // Wait for next month's list before opening its row.
  await expect(row(page, isMobile, "Sofá Novo")).toContainText("2/3");
  await row(page, isMobile, "Sofá Novo").getByRole("button").first().click();
  await expect(dialog.getByText(/Parcela 2 de 3/)).toBeVisible();
  await expect(dialog.getByLabel("Observação")).toHaveValue("Sala");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await open(page, "Contas");
  await expect(
    page
      .getByRole("list", { name: "Contas" })
      .getByRole("listitem")
      .filter({ hasText: "Banco Azul" }),
  ).toContainText("Saldo atual R$ 955,00");
});
