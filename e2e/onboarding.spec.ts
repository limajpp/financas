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

const invite = (page: Page) => page.getByRole("region", { name: "Termine de configurar o app" });

test("CA5: o cadastro leva ao onboarding; pular deixa o convite no início, e o app funciona", async ({
  page,
}) => {
  test.slow();
  const { name } = await signUp(page, { onboarding: true });
  await expect(page.getByText("Passo 1 de 4")).toBeVisible();

  await page.getByRole("link", { name: "Pular por agora" }).click();
  await expect(page.getByRole("heading", { name: `Olá, ${name}` })).toBeVisible();
  await expect(invite(page)).toBeVisible();

  // The app works without the onboarding: an account and an expense.
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
  for (const digit of "2500")
    await keypad.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: /^Salvar/ }).click();
  await expect(page.getByText("Despesa de R$ 25,00 salva")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Olá/ }).first()).toBeVisible();

  // "Continuar" goes back to it.
  await invite(page).getByRole("link", { name: "Continuar" }).click();
  await expect(page.getByText("Passo 1 de 4")).toBeVisible();
  await expect(page.getByRole("list", { name: "Contas cadastradas" })).toContainText("Banco Azul");
  await page.getByRole("link", { name: "Pular por agora" }).click();

  // "Não mostrar mais" takes it away, for good.
  await invite(page).getByRole("button", { name: "Não mostrar mais" }).click();
  await expect(invite(page)).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: /^Olá/ }).first()).toBeVisible();
  await expect(invite(page)).toBeHidden();
});

test("CA6: um onboarding completo termina no início, com as faturas certas", async ({ page }) => {
  test.slow();
  await signUp(page, { onboarding: true });
  const dialog = page.getByRole("dialog");

  // 1. An account.
  await page.getByRole("button", { name: "Adicionar conta" }).click();
  await dialog.getByLabel("Nome").fill("Banco Azul");
  await dialog.getByLabel("Saldo inicial em reais").fill("1.000,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("list", { name: "Contas cadastradas" })).toContainText("R$ 1.000,00");
  await page.getByRole("link", { name: "Próximo" }).click();

  // 2. A card and what its open invoice already has.
  await expect(page.getByText("Passo 2 de 4")).toBeVisible();
  await page.getByRole("button", { name: "Adicionar cartão" }).click();
  await dialog.getByLabel("Nome").fill("Cartão Roxo");
  await dialog.getByLabel("Fecha dia").selectOption("3");
  await dialog.getByLabel("Vence dia").selectOption("10");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  const card = page.getByRole("list", { name: "Cartões cadastrados" }).getByRole("listitem");
  // Leaving the field saves it: "Próximo" without "Salvar" keeps the amount.
  await card.getByLabel(/^Quanto já tem na fatura aberta/).fill("800,00");
  await page.getByRole("link", { name: "Próximo" }).click();
  await expect(page.getByText(/do Cartão Roxo: R\$\s800,00$/)).toBeVisible();
  await expect(page.getByText("Passo 3 de 4")).toBeVisible();
  await page.getByRole("link", { name: "Voltar" }).click();
  await expect(card.getByLabel(/^Quanto já tem na fatura aberta/)).toHaveValue("800,00");
  await page.getByRole("link", { name: "Próximo" }).click();

  // 3. An ongoing purchase: its current installment comes off the open invoice's amount.
  await expect(page.getByText("Passo 3 de 4")).toBeVisible();
  await page.getByRole("button", { name: "Adicionar parcelamento" }).click();
  await dialog.getByLabel("O que foi").fill("Loja Grande");
  await dialog.getByLabel("Parcela atual").fill("3");
  await dialog.getByLabel("De quantas").fill("10");
  await dialog.getByLabel("Valor de cada parcela em reais").fill("150,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(/A parcela 3 \(R\$\s150,00\) já fazia parte da fatura aberta informada\./),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Parcelamentos cadastrados" })).toContainText(
    "Cartão Roxo · 3 de 10",
  );
  await page.getByRole("link", { name: "Próximo" }).click();

  // 4. A subscription: no charge now.
  await expect(page.getByText("Passo 4 de 4")).toBeVisible();
  await page.getByRole("button", { name: "Adicionar assinatura" }).click();
  await dialog.getByLabel("O que é").fill("Streaming Azul");
  await dialog.getByLabel("Valor por mês em reais").fill("39,90");
  await dialog.getByLabel("Dia da cobrança").selectOption("8");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("list", { name: "Assinaturas cadastradas" })).toContainText(
    "Todo dia 8 · Cartão Roxo",
  );

  await page.getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByRole("heading", { name: /^Olá/ }).first()).toBeVisible();
  await expect(invite(page)).toBeHidden();

  // The open invoice is what the bank showed; the 7 installments left follow, one per invoice.
  await visit(page, "/faturas");
  const open = page.getByRole("region", { name: "Fatura atual" });
  await expect(open).toContainText("R$ 800,00");
  const upcoming = page.getByRole("list", { name: "Próximas", exact: true }).getByRole("listitem");
  await expect(upcoming).toHaveCount(7);
  for (const row of await upcoming.all()) await expect(row).toContainText("R$ 150,00");

  await open.getByRole("link", { name: "Ver fatura" }).click();
  const entries = page.getByRole("list", { name: "Lançamentos", exact: true });
  await expect(entries).toContainText("Saldo anterior da fatura");
  await expect(entries).toContainText("Antes do app");
  await expect(entries).toContainText("3/10");

  // The subscription charged nothing yet: the list has the installment and the opening balance.
  await visit(page, "/lancamentos");
  const list = page.getByRole("main");
  await expect(list.getByRole("button", { name: "Loja Grande" }).first()).toBeVisible();
  await expect(
    list.getByRole("button", { name: "Saldo anterior da fatura" }).first(),
  ).toBeVisible();
  await expect(list.getByRole("button", { name: "Streaming Azul" })).toHaveCount(0);
});
