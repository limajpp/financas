import { expect, test } from "@playwright/test";

import { signUp } from "./helpers";

test("cadastra, edita e arquiva uma conta", async ({ page }) => {
  await signUp(page);
  await page.goto("/contas");
  await expect(page.getByRole("heading", { name: "Contas", level: 1 })).toBeVisible();

  const dialog = page.getByRole("dialog");
  const list = page.getByRole("list", { name: "Contas" });

  // Criar.
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill("Banco Azul");
  await dialog.getByLabel("Saldo inicial em reais").fill("1.234,56");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  const azul = list.getByRole("listitem").filter({ hasText: "Banco Azul" });
  await expect(azul).toContainText("R$ 1.234,56");

  // Valor inválido mostra o erro no campo.
  await page.getByRole("button", { name: "Nova conta" }).click();
  await dialog.getByLabel("Nome").fill("Carteira");
  await dialog.getByLabel("Saldo inicial em reais").fill("12.5");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog.getByText("Valor inválido. Use o formato 1.234,56.")).toBeVisible();

  // Saldo negativo pela opção (o teclado do iPhone não tem a tecla de menos).
  await dialog.getByLabel("Saldo inicial em reais").fill("350");
  await dialog.getByLabel("Saldo negativo (cheque especial)").click();
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(list.getByRole("listitem").filter({ hasText: "Carteira" })).toContainText(
    "-R$ 350,00",
  );

  // Editar nome e saldo.
  await page.getByRole("button", { name: "Editar Banco Azul" }).click();
  await expect(dialog.getByLabel("Saldo inicial em reais")).toHaveValue("1.234,56");
  await dialog.getByLabel("Nome").fill("Banco Verde");
  await dialog.getByLabel("Saldo inicial em reais").fill("2000");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  const verde = list.getByRole("listitem").filter({ hasText: "Banco Verde" });
  await expect(verde).toContainText("R$ 2.000,00");

  // Arquivar tira da lista; "Mostrar arquivadas" traz de volta.
  await page.getByRole("button", { name: "Arquivar Banco Verde" }).click();
  await expect(verde).toBeHidden();
  await page.getByLabel("Mostrar arquivadas").click();
  await expect(verde.getByText("Arquivada")).toBeVisible();
  await verde.getByRole("button", { name: "Desarquivar Banco Verde" }).click();
  await expect(verde.getByText("Arquivada")).toBeHidden();
});
