import { expect, type Page, test } from "@playwright/test";

import { todayInSaoPaulo } from "../src/domain/dates";
import { formatBRL } from "../src/domain/money";
import { signUp, expectHome, visit } from "./helpers";

async function createAccount(page: Page) {
  await visit(page, "/contas");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill("Banco Azul");
  await dialog.getByLabel("Saldo inicial em reais").fill("1.000,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
}

async function createCard(page: Page) {
  await visit(page, "/contas");
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Novo cartão" }).click();
  await dialog.getByLabel("Nome").fill("Cartão Roxo");
  await dialog.getByLabel("Fecha dia").selectOption("3");
  await dialog.getByLabel("Vence dia").selectOption("10");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
}

/** An entry by Pix, today, from the register screen. */
async function register(
  page: Page,
  digits: string,
  what: string,
  {
    income = false,
    category,
    subscription = false,
  }: { income?: boolean; category?: string; subscription?: boolean } = {},
) {
  // A click, not page.goto: the previous save's trip home may still be under way.
  await page.getByRole("link", { name: "Registrar", exact: true }).click();
  await expect(page).toHaveURL(/\/registrar$/);
  if (income) {
    await page
      .getByRole("group", { name: "Tipo" })
      .getByRole("button", { name: "Receita" })
      .click();
  }
  const keypad = page.getByRole("group", { name: "Teclado numérico" });
  for (const digit of digits)
    await keypad.getByRole("button", { name: digit, exact: true }).click();
  await page.getByLabel("O que foi?").fill(what);
  await page.getByLabel("O que foi?").press("Escape");
  if (category) {
    await page
      .getByRole("group", { name: "Categoria" })
      .getByRole("button", { name: category })
      .click();
  }
  if (subscription) await page.getByLabel("Assinatura").click();
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText(/(Despesa|Receita|Assinatura) de .* salva$/).first()).toBeVisible();
  await expectHome(page);
  await expect(page).toHaveURL(/:\d+\/$/);
}

const kpi = (page: Page, label: string) => page.getByRole("group", { name: label, exact: true });

test("CA1, CA3, CA5: os KPIs batem com as métricas, o início do celular e os links", async ({
  page,
  isMobile,
}) => {
  test.slow();
  await signUp(page);
  await createAccount(page);
  await createCard(page);
  await register(page, "500000", "Salário", { income: true });
  await register(page, "20000", "Mercado Central", { category: "Alimentação" });
  await register(page, "3990", "Streaming", { subscription: true });

  // CA1, by hand: today is day D of a month of N days.
  //   expense so far 200,00 + 39,90 = 239,90; leftover 5.000 − 239,90 = 4.760,10;
  //   rate 4.760,10 / 5.000 = 95,2% → 95%;
  //   variable 200,00 (the subscription is fixed): + 200 × (N − D) / D; its next charge is next
  //   month, so nothing fixed is still to come;
  //   committed: the subscription in each of the next 6 months, 6 × 39,90 = 239,40.
  const today = todayInSaoPaulo();
  const day = Number(today.slice(8, 10));
  const [y, m] = today.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const projected = 23_990 + Math.round((20_000 * (days - day)) / day);

  await visit(page, "/");
  await expect(kpi(page, "Sobra até agora")).toContainText(formatBRL(476_010));
  await expect(kpi(page, "Sobra até agora")).toContainText(
    `${formatBRL(500_000)} de receitas, ${formatBRL(23_990)} de despesas`,
  );
  await expect(kpi(page, "Taxa de poupança")).toContainText("95%");
  await expect(kpi(page, "Projeção do mês")).toContainText(formatBRL(projected));
  if (day < 5) await expect(kpi(page, "Projeção do mês")).toContainText("estimativa");
  await expect(kpi(page, "Comprometido no futuro")).toContainText(formatBRL(23_940));
  await expect(kpi(page, "Comprometido no futuro")).toContainText("sem parcelas a pagar");

  // The insights: two standing facts (the first month has no averages yet).
  const insights = page.getByRole("region", { name: "Destaques" }).getByRole("link");
  await expect(insights).toHaveText([
    `Informação: Sua assinatura custa ${formatBRL(47_880)} por ano (${formatBRL(3_990)} por mês).`,
    `Informação: Onde você mais gastou este mês: Mercado Central, ${formatBRL(20_000)} em 1 compra (83% das despesas).`,
  ]);

  // CA3: the phone's home, of today. A computer doesn't show it.
  const today_ = page.getByRole("group", { name: "Gasto hoje" });
  if (isMobile) {
    await expect(today_).toContainText(formatBRL(23_990));
    await expect(page.getByRole("group", { name: "Gasto do mês" })).toContainText(
      formatBRL(23_990),
    );
    await expect(page.getByRole("group", { name: "Sobra do mês" })).toContainText(
      formatBRL(476_010),
    );
    const cards = page.getByRole("region", { name: "Faturas atuais" });
    await expect(cards.getByRole("link")).toContainText(["Cartão Roxo"]);
    await expect(cards).toContainText("vence em");
    const recent = page.getByRole("region", { name: "Últimos lançamentos" }).getByRole("listitem");
    await expect(recent).toHaveCount(3);
    await expect(recent.nth(0)).toContainText("Streaming");
    await expect(recent.nth(2)).toContainText("Salário");
    await page.getByRole("link", { name: "Registrar um lançamento" }).click();
    await expect(page).toHaveURL(/\/registrar$/);
    await visit(page, "/");
  } else {
    await expect(today_).toBeHidden();
  }

  // CA5: an insight leads to its subject; a category row, to the month's entries.
  await insights.first().click();
  await expect(page).toHaveURL(/\/assinaturas$/);
  await visit(page, "/");
  await page
    .getByRole("region", { name: "Categorias × média" })
    .getByRole("link", { name: /Alimentação/ })
    .click();
  await expect(page).toHaveURL(/\/lancamentos\?categoria=[^&]+&de=\d{4}-\d{2}-01&ate=/);
  // The list has a phone and a computer arrangement: only the visible one counts.
  const shown = (text: string) => page.getByText(text, { exact: true }).filter({ visible: true });
  await expect(shown("Mercado Central").first()).toBeVisible();
  await expect(shown("Streaming")).toHaveCount(0);
});

test("CA2, CA4: uma conta nova, o convite e o seletor no primeiro mês", async ({ page }) => {
  await signUp(page);
  // CA4: nothing registered yet.
  await expect(
    page.getByText("Registre seu primeiro gasto para ver o resumo do mês."),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Destaques" })).toContainText(
    "Nada fora do comum neste mês. Os alertas de categoria começam em",
  );
  await expect(page.getByRole("group", { name: "Projeção do mês" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Evolução de 6 meses" })).toHaveCount(0);
  await expect(page.getByText("Nenhum gasto neste mês.")).toBeVisible();

  // CA2: the first month is today's: neither arrow leads anywhere.
  const summary = page.getByRole("region", { name: /de \d{4}$/ });
  const title = await summary.getByRole("heading", { level: 2 }).textContent();
  await expect(page.getByRole("link", { name: "Mês anterior" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Próximo mês" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Voltar para este mês" })).toHaveCount(0);
  // An invalid, a future and an old month all open this one.
  for (const mes of ["abc", "2999-12", "2001-01"]) {
    await visit(page, `/?mes=${mes}`);
    await expect(summary.getByRole("heading", { level: 2 })).toHaveText(title!);
  }

  // A click while the page still hydrates may land on a link React then takes over (WebKit):
  // clicking again until the register opens.
  // A late first click may still navigate: only click again while the register isn't open.
  await expect(async () => {
    if (!page.url().endsWith("/registrar")) {
      await page
        .getByRole("link", { name: "Registrar o primeiro gasto" })
        .click({ timeout: 2_000 });
    }
    await expect(page).toHaveURL(/\/registrar$/, { timeout: 2_000 });
  }).toPass();
});
