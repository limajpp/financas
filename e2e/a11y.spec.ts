import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { signUp, visit } from "./helpers";

/**
 * The screen as the person sees it: the title shown and nothing still loading. Not "networkidle":
 * the app keeps requests open (WebKit never got there).
 */
async function settled(page: Page) {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByText(/^Carregando/)).toHaveCount(0);
}

/** The WCAG 2.1 A and AA rules; only serious and critical violations fail (task 26). */
async function violations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
}

/** The main screens, with something on them: an account, a card, an income, a purchase. */
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
  for (const [digits, what, income] of [
    ["500000", "Empresa Exemplo", true],
    ["12000", "Mercado Central", false],
  ] as const) {
    await page.getByRole("link", { name: "Registrar", exact: true }).click();
    await expect(page).toHaveURL(/\/registrar$/);
    if (income) {
      await page
        .getByRole("group", { name: "Tipo" })
        .getByRole("button", { name: "Receita" })
        .click();
    }
    const keypad = page.getByRole("group", { name: "Teclado numérico" });
    for (const d of digits) await keypad.getByRole("button", { name: d, exact: true }).click();
    await page.getByLabel("O que foi?").fill(what);
    await page.getByLabel("O que foi?").press("Escape");
    await page.getByRole("button", { name: /^Salvar/ }).click();
    await expect(page).toHaveURL(/:\d+\/$/);
  }
}

const SCREENS = [
  "/",
  "/registrar",
  "/lancamentos",
  "/faturas",
  "/contas",
  "/assinaturas",
  "/estabelecimentos",
];

test("CA5: as telas principais não têm violação séria nem crítica, no claro e no escuro", async ({
  page,
}) => {
  test.slow();
  await setup(page);
  const found: Record<string, unknown> = {};
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const url of SCREENS) {
      await visit(page, url);
      await settled(page);
      const list = await violations(page);
      if (list.length > 0) found[`${scheme} ${url}`] = list;
    }
    // Logged in: without a session, the proxy sends an unknown address to the login instead.
    await visit(page, "/nao-existe");
    await expect(
      page.getByRole("heading", { level: 1, name: "Página não encontrada" }),
    ).toBeVisible();
    const notFound = await violations(page);
    if (notFound.length > 0) found[`${scheme} /nao-existe`] = notFound;
    // The home's chart loads near the screen: scrolled to, it's audited too.
    await visit(page, "/");
    await settled(page);
    const chart = page.getByRole("region", { name: "Evolução de 6 meses" });
    await chart.scrollIntoViewIfNeeded();
    await expect(chart.locator(".recharts-surface").first()).toBeVisible();
    const withChart = await violations(page);
    if (withChart.length > 0) found[`${scheme} / (gráfico)`] = withChart;
  }
  expect(found).toEqual({});
});

test("CA5: a entrada e o cadastro, no claro e no escuro", async ({ page }) => {
  const found: Record<string, unknown> = {};
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const url of ["/entrar", "/cadastro"]) {
      await visit(page, url);
      await settled(page);
      const list = await violations(page);
      if (list.length > 0) found[`${scheme} ${url}`] = list;
    }
  }
  expect(found).toEqual({});
});
