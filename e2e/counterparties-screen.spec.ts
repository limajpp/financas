import { expect, type Page, test } from "@playwright/test";

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

async function setup(page: Page) {
  await signUp(page);
  await visit(page, "/contas");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill("Banco Azul");
  await dialog.getByLabel("Saldo inicial em reais").fill("1.000,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
}

/** An expense by Pix, today. */
async function spend(page: Page, what: string, digits: string) {
  await page.getByRole("link", { name: "Registrar", exact: true }).click();
  await expect(page).toHaveURL(/\/registrar$/);
  const keypad = page.getByRole("group", { name: "Teclado numérico" });
  for (const digit of digits)
    await keypad.getByRole("button", { name: digit, exact: true }).click();
  await page.getByLabel("O que foi?").fill(what);
  await page.getByLabel("O que foi?").press("Escape");
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText(/^Despesa de .* salva$/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();
  await expect(page).toHaveURL(/:\d+\/$/);
}

const ranking = (page: Page) => page.getByRole("list", { name: "Ranking" }).getByRole("listitem");

test("CA5: o ranking por valor e por frequência, e o detalhe com total e ticket médio", async ({
  page,
}) => {
  test.slow();
  await setup(page);
  await spend(page, "Mercado Central", "20000");
  await spend(page, "Padaria", "1000");
  await spend(page, "Padaria", "1200");
  await spend(page, "Padaria", "800");

  await visit(page, "/estabelecimentos");
  await expect(ranking(page).nth(0)).toContainText("Mercado Central");
  await expect(ranking(page).nth(0)).toContainText("R$ 200,00");
  await expect(ranking(page).nth(1)).toContainText("Padaria");
  await expect(ranking(page).nth(1)).toContainText("3 compras");

  // The search finds any counterparty in use.
  await page.getByPlaceholder("Buscar estabelecimento").fill("merc");
  await expect(
    page.getByRole("list", { name: "Resultados da busca" }).getByRole("link"),
  ).toHaveText(["Mercado Central"]);
  await page.getByPlaceholder("Buscar estabelecimento").fill("");

  await page.getByRole("group", { name: "Ordem" }).getByText("Por frequência").click();
  await expect(ranking(page).nth(0)).toContainText("Padaria");

  await ranking(page).nth(0).getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Padaria", level: 1 })).toBeVisible();
  const numbers = page.getByRole("region", { name: "Números do período" });
  const stat = (label: string) =>
    numbers
      .locator("div")
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator("dd");
  await expect(stat("Total")).toHaveText("R$ 30,00");
  await expect(stat("Compras")).toHaveText("3");
  await expect(stat("Ticket médio")).toHaveText("R$ 10,00");
  await expect(page.getByRole("list", { name: "Lançamentos" }).getByRole("listitem")).toHaveCount(
    3,
  );
});

test("CA6: mesclar deixa um estabelecimento só, com os lançamentos somados", async ({ page }) => {
  test.slow();
  await setup(page);
  await spend(page, "Padaria do bairro", "1000");
  await spend(page, "Padaria Sao Joao", "2000");
  await spend(page, "Padaria Sao Joao", "500");

  await visit(page, "/estabelecimentos");
  await ranking(page).filter({ hasText: "Padaria do bairro" }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Padaria do bairro", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Mesclar com…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Buscar").fill("sao joao");
  await dialog.getByRole("button", { name: "Padaria Sao Joao" }).click();
  await expect(dialog).toContainText(
    "Os 2 lançamentos de “Padaria Sao Joao” passam para “Padaria do bairro”.",
  );
  await dialog.getByRole("button", { name: "Mesclar", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Estabelecimentos mesclados")).toBeVisible();

  await expect(page.getByText("No extrato: Padaria Sao Joao")).toBeVisible();
  const numbers = page.getByRole("region", { name: "Números do período" });
  await expect(numbers).toContainText("R$ 35,00");

  await visit(page, "/estabelecimentos");
  await expect(ranking(page)).toHaveCount(1);
  await expect(ranking(page)).toContainText("Padaria do bairro");
});

test("editar a memória muda o nome e guarda o nome no extrato", async ({ page }) => {
  test.slow();
  await setup(page);
  await spend(page, "Padaria", "1000");
  await visit(page, "/estabelecimentos");
  await ranking(page).first().getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Padaria", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Editar" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome", { exact: true }).fill("Padaria do bairro");
  await dialog.getByLabel("Novo nome no extrato").fill("PAG*PADARIA");
  await dialog.getByRole("button", { name: "Adicionar" }).click();
  await dialog.getByLabel("CPF/CNPJ").fill("123");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog.getByRole("alert")).toContainText("CPF (11 dígitos) ou um CNPJ");
  await dialog.getByLabel("CPF/CNPJ").fill("");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Padaria do bairro", level: 1 })).toBeVisible();
  await expect(page.getByText("No extrato: PAG*PADARIA")).toBeVisible();
});
