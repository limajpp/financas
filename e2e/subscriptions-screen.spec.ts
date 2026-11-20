import { expect, type Page, test } from "@playwright/test";

import { signUp, expectHome } from "./helpers";

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

/** A subscription by Pix, today, from the register screen. */
async function subscribe(page: Page, what: string, digits: string) {
  await page.getByRole("link", { name: "Registrar", exact: true }).click();
  await expect(page).toHaveURL(/\/registrar$/);
  const keypad = page.getByRole("group", { name: "Teclado numérico" });
  for (const digit of digits)
    await keypad.getByRole("button", { name: digit, exact: true }).click();
  await page.getByLabel("O que foi?").fill(what);
  await page.getByLabel("O que foi?").press("Enter");
  await page.getByLabel("Assinatura").click();
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText(/^Assinatura de .* salva$/).first()).toBeVisible();
  await expectHome(page);
  await expect(page).toHaveURL(/:\d+\/$/);
}

const totals = (page: Page) => page.getByRole("region", { name: "Totais" });
const section = (page: Page, name: "Ativas" | "Pausadas" | "Canceladas") =>
  page.getByRole("list", { name, exact: true });

test("CA6: totais por mês e por ano; pausar e cancelar tiram dos totais", async ({ page }) => {
  test.slow();
  await setup(page);
  await subscribe(page, "Streaming", "3990");
  await subscribe(page, "Academia", "12000");

  await visit(page, "/assinaturas");
  await expect(totals(page)).toContainText("R$ 159,90");
  await expect(totals(page)).toContainText("R$ 1.918,80");
  await expect(totals(page)).toContainText("2 assinaturas ativas");
  // Most expensive first.
  await expect(section(page, "Ativas").getByRole("listitem").first()).toContainText("Academia");

  const dialog = page.getByRole("dialog");
  await section(page, "Ativas")
    .getByRole("button", { name: /Streaming/ })
    .click();
  // "Ver cobranças": the counterparty, from the 1st charge's month up to today.
  await expect(dialog.getByRole("link", { name: "Ver cobranças" })).toHaveAttribute(
    "href",
    /^\/lancamentos\?estabelecimento=[\w-]+&de=\d{4}-\d{2}-01&ate=\d{4}-\d{2}-\d{2}$/,
  );
  await dialog.getByRole("button", { name: "Pausar" }).click();
  await expect(dialog).toContainText("Os meses pausados não são cobrados.");
  await dialog.getByRole("button", { name: "Pausar" }).click();
  await expect(dialog).toBeHidden();
  await expect(totals(page)).toContainText("R$ 120,00");
  await expect(totals(page)).toContainText("1 assinatura ativa");
  await expect(section(page, "Pausadas")).toContainText("Streaming");
  await expect(section(page, "Pausadas")).toContainText("Pausada desde");

  await section(page, "Ativas")
    .getByRole("button", { name: /Academia/ })
    .click();
  await dialog.getByRole("button", { name: "Cancelar assinatura" }).click();
  await expect(dialog).toContainText("Não dá para desfazer.");
  await dialog.getByRole("button", { name: "Cancelar assinatura" }).click();
  await expect(dialog).toBeHidden();
  await expect(totals(page)).toContainText("R$ 0,00");
  await expect(page.getByText("Nenhuma assinatura ativa.")).toBeVisible();
  await page.getByRole("button", { name: /^Mostrar canceladas/ }).click();
  await expect(page.getByRole("button", { name: "Ocultar canceladas" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(section(page, "Canceladas")).toContainText("Academia");
  await expect(section(page, "Canceladas")).toContainText("Cancelada em");
});

test("CA5: uma assinatura que mudou de valor aparece destacada com o valor anterior", async ({
  page,
}) => {
  test.slow();
  await setup(page);
  await subscribe(page, "Streaming", "3490");

  await visit(page, "/assinaturas");
  const dialog = page.getByRole("dialog");
  await section(page, "Ativas")
    .getByRole("button", { name: /Streaming/ })
    .click();
  await dialog.getByRole("button", { name: "Editar" }).click();
  await dialog.getByLabel("Valor por mês").fill("39,90");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Assinatura atualizada")).toBeVisible();

  const row = section(page, "Ativas").getByRole("listitem").filter({ hasText: "Streaming" });
  await expect(row).toContainText("R$ 39,90");
  await expect(row).toContainText(/Era R\$\s34,90 · subiu em \d{2}\/\d{2}\/\d{4}/);
  await expect(totals(page)).toContainText("R$ 478,80");
});

test("sem assinaturas, a tela explica como criar uma", async ({ page }) => {
  await signUp(page);
  await visit(page, "/assinaturas");
  await expect(page.getByText(/Nenhuma assinatura ainda/)).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Registrar" })).toBeVisible();
});
