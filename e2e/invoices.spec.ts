import { expect, type Page, test } from "@playwright/test";

import { addDays, formatCalendarDate, todayInSaoPaulo } from "../src/domain/dates";
import { signUp, expectHome } from "./helpers";

/**
 * page.goto that survives Next's fallback: home shows before its data request ends, a goto then
 * aborts that request, and Next answers with a full load of "/" that interrupts the goto (seen in
 * WebKit). A person moves by tapping links, which don't abort it.
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

/** An account and the "Cartão Roxo" (closes on the 3rd, due on the 10th). */
async function setup(page: Page) {
  await signUp(page);
  await visit(page, "/contas");
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

/** An expense (or a refund) on the card, from the register screen. */
async function register(
  page: Page,
  digits: string,
  {
    refund = false,
    date,
    installments,
    saved,
  }: { refund?: boolean; date?: string; installments?: string; saved: string },
) {
  // A click, not page.goto: the previous save's trip home may still be under way.
  await page.getByRole("link", { name: "Registrar", exact: true }).click();
  await expect(page).toHaveURL(/\/registrar$/);
  if (refund) await page.getByRole("group", { name: "Tipo" }).getByText("Receita").click();
  const sheet = page.getByRole("dialog");
  await page.getByRole("button", { name: /^Forma de pagamento:/ }).click();
  await sheet.getByRole("button", { name: /^Crédito/ }).click();
  await sheet.getByRole("button", { name: "Cartão Roxo", exact: true }).click();
  await expect(sheet).toBeHidden();
  const keypad = page.getByRole("group", { name: "Teclado numérico" });
  for (const digit of digits)
    await keypad.getByRole("button", { name: digit, exact: true }).click();
  if (date) await page.getByLabel("Data", { exact: true }).fill(date);
  if (installments) {
    await page.getByLabel("Parcelado").click();
    await page.getByLabel("Número de parcelas").selectOption(installments);
  }
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText(saved)).toBeVisible();
  await expectHome(page);
  await expect(page).toHaveURL(/:\d+\/$/);
}

const openInvoice = (page: Page) => page.getByRole("region", { name: "Fatura atual" });
const section = (page: Page, name: "Próximas" | "Anteriores" | "Lançamentos") =>
  page.getByRole("list", { name, exact: true });

test("CA3: uma compra em 3× aparece na fatura atual e nas duas próximas", async ({ page }) => {
  test.slow();
  await setup(page);
  await register(page, "30000", { installments: "3", saved: "Despesa de R$ 300,00 em 3× salva" });

  await visit(page, "/faturas");
  await expect(page.getByRole("link", { name: "Cartão Roxo" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(openInvoice(page)).toContainText("R$ 100,00");
  const upcoming = section(page, "Próximas").getByRole("listitem");
  await expect(upcoming).toHaveCount(2);
  for (const row of await upcoming.all()) await expect(row).toContainText("R$ 100,00");

  await openInvoice(page).getByRole("link", { name: "Ver fatura" }).click();
  await expect(page.getByRole("heading", { name: "Fatura · Cartão Roxo" })).toBeVisible();
  await expect(section(page, "Lançamentos")).toContainText("1/3");

  for (const [index, number] of [
    [0, "2/3"],
    [1, "3/3"],
  ] as const) {
    await visit(page, "/faturas");
    await section(page, "Próximas").getByRole("link").nth(index).click();
    await expect(page.getByRole("heading", { name: "Fatura · Cartão Roxo" })).toBeVisible();
    await expect(page.getByText("Futura")).toBeVisible();
    await expect(section(page, "Lançamentos")).toContainText(number);
  }
});

test("CA6: um estorno no crédito abate a fatura atual", async ({ page }) => {
  test.slow();
  await setup(page);
  await register(page, "10000", { saved: "Despesa de R$ 100,00 salva" });
  await register(page, "2500", { refund: true, saved: "Estorno de R$ 25,00 salvo" });

  await visit(page, "/faturas");
  await expect(openInvoice(page)).toContainText("R$ 75,00");
  await openInvoice(page).getByRole("link", { name: "Ver fatura" }).click();
  await expect(page.getByRole("heading", { name: "Fatura · Cartão Roxo" })).toBeVisible();
  const refund = section(page, "Lançamentos").getByRole("listitem").filter({ hasText: "Estorno" });
  await expect(refund).toContainText("Reembolsos");
  await expect(refund).toContainText("−R$ 25,00");
});

test("CA4: mover um lançamento para a fatura seguinte atualiza as duas", async ({ page }) => {
  test.slow();
  await setup(page);
  await register(page, "10000", { saved: "Despesa de R$ 100,00 salva" });

  await visit(page, "/faturas");
  await openInvoice(page).getByRole("link", { name: "Ver fatura" }).click();
  await expect(page.getByRole("heading", { name: "Fatura · Cartão Roxo" })).toBeVisible();
  await section(page, "Lançamentos").getByRole("button").first().click();
  const dialog = page.getByRole("dialog");
  const invoice = dialog.getByLabel("Fatura (vencimento)");
  const current = await invoice.inputValue();
  const options = await invoice
    .locator("option")
    .evaluateAll((all) => all.map((o) => (o as HTMLOptionElement).value));
  await invoice.selectOption(options[options.indexOf(current) + 1]!);
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Nenhum lançamento nesta fatura.")).toBeVisible();

  await visit(page, "/faturas");
  await expect(openInvoice(page)).toContainText("R$ 0,00");
  await expect(section(page, "Próximas").getByRole("listitem")).toHaveCount(1);
  await expect(section(page, "Próximas")).toContainText("R$ 100,00");
});

test("CA8: pagar uma fatura fechada pelo detalhe a deixa paga", async ({ page }) => {
  test.slow();
  await setup(page);
  // 45 days ago: its invoice has closed (the card closes every month).
  const date = addDays(todayInSaoPaulo(), -45);
  await register(page, "5000", { date, saved: "Despesa de R$ 50,00 salva" });

  await visit(page, "/faturas");
  const past = section(page, "Anteriores").getByRole("listitem");
  await expect(past).toHaveCount(1);
  await expect(past).toContainText("A pagar R$ 50,00");
  await past.getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Fatura · Cartão Roxo" })).toBeVisible();

  await page.getByRole("button", { name: "Pagar fatura" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Valor pago em reais")).toHaveValue("50,00");
  await dialog.getByRole("button", { name: "Salvar pagamento" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Paga", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Pagamentos" })).toContainText(
    `Pago em ${formatCalendarDate(todayInSaoPaulo())}`,
  );
  await expect(page.getByRole("button", { name: "Pagar fatura" })).toHaveCount(0);

  await visit(page, "/faturas");
  await expect(section(page, "Anteriores").getByRole("listitem")).toContainText("Paga");
});

test("sem cartões, a tela leva ao cadastro", async ({ page }) => {
  await signUp(page);
  await visit(page, "/faturas");
  await expect(page.getByText("Você ainda não tem cartões.")).toBeVisible();
  await page.getByRole("link", { name: "Cadastrar cartão" }).click();
  await expect(page).toHaveURL(/\/contas/);
});
