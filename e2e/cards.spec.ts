import { expect, type Page, test } from "@playwright/test";

import { formatCalendarDate, todayInSaoPaulo } from "../src/domain/dates";
import { invoiceFor } from "../src/domain/invoice-cycle";
import { signUp } from "./helpers";

async function createAccount(page: Page, name: string) {
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill(name);
  await dialog.getByLabel("Saldo inicial em reais").fill("0");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
}

test("cadastra, edita e arquiva um cartão", async ({ page }) => {
  await signUp(page);
  await page.goto("/contas");
  const dialog = page.getByRole("dialog");

  // Sem conta, o cartão pede uma conta primeiro.
  await page.getByRole("button", { name: "Novo cartão" }).click();
  await expect(dialog.getByRole("heading", { name: "Nova conta primeiro" })).toBeVisible();
  await dialog.getByRole("button", { name: "Entendi" }).click();
  await expect(dialog).toBeHidden();

  await createAccount(page, "Banco Azul");

  // Criar: a prévia mostra em qual fatura uma compra de hoje cai.
  await page.getByRole("button", { name: "Novo cartão" }).click();
  await dialog.getByLabel("Nome").fill("Cartão Roxo");
  await dialog.getByLabel("Fecha dia").selectOption("3");
  await dialog.getByLabel("Vence dia").selectOption("10");
  await expect(dialog.getByText(/Uma compra hoje cai na fatura que fecha em/)).toBeVisible();
  await dialog.getByLabel("Limite (opcional) em reais").fill("5.000");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();

  const cards = page.getByRole("list", { name: "Cartões" });
  const roxo = cards.getByRole("listitem").filter({ hasText: "Cartão Roxo" });
  await expect(roxo).toContainText("Paga com Banco Azul · Fecha dia 3 · vence dia 10");
  const open = invoiceFor({ closingDay: 3, dueDay: 10 }, todayInSaoPaulo());
  await expect(roxo).toContainText(`Fatura aberta vence em ${formatCalendarDate(open.dueDate)}`);
  await expect(roxo).toContainText("Limite R$ 5.000,00");

  // No dia do cadastro, editar os dias é uma correção: vale para todas as compras, sem o aviso
  // de "a partir de hoje" (o aviso, nos dias seguintes, está coberto pela integração).
  await page.getByRole("button", { name: "Editar Cartão Roxo" }).click();
  await dialog.getByLabel("Fecha dia").selectOption("31");
  await dialog.getByLabel("Vence dia").selectOption("7");
  await expect(dialog.getByText(/A mudança vale para compras a partir de hoje/)).toBeHidden();
  await expect(dialog.getByText("Nos meses mais curtos, vale o último dia do mês.")).toBeVisible();
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(roxo).toContainText("Fecha dia 31 · vence dia 7");

  // Arquivar tira da lista; "Mostrar arquivadas" traz de volta.
  await page.getByRole("button", { name: "Arquivar Cartão Roxo" }).click();
  await expect(roxo).toBeHidden();
  await page.getByLabel("Mostrar arquivadas").click();
  await expect(roxo.getByText("Arquivado")).toBeVisible();
});
