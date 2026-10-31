import { expect, test } from "@playwright/test";

import { signUp } from "./helpers";

test("gerencia as categorias a partir da lista padrão", async ({ page }) => {
  await signUp(page);
  await page.goto("/configuracoes");
  await page.getByRole("link", { name: "Categorias" }).click();
  await expect(page.getByRole("heading", { name: "Categorias" })).toBeVisible();

  // Lista padrão: Moradia > Aluguel, marcada como fixa.
  const moradia = page.getByRole("list", { name: "Subcategorias de Moradia" });
  const aluguel = moradia.getByRole("listitem").filter({ hasText: "Aluguel" });
  await expect(aluguel.getByText("Fixa")).toBeVisible();

  // Nova subcategoria.
  await page.getByRole("button", { name: "Nova subcategoria em Moradia" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome").fill("IPTU");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(moradia.getByText("IPTU")).toBeVisible();

  // Nome repetido entre irmãs é recusado.
  await page.getByRole("button", { name: "Nova subcategoria em Moradia" }).click();
  await dialog.getByLabel("Nome").fill("iptu");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog.getByText("Já existe uma categoria com esse nome aqui.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Renomear e trocar ícone e cor.
  await page.getByRole("button", { name: "Editar IPTU" }).click();
  await dialog.getByLabel("Nome").fill("Imposto da casa");
  await dialog.getByRole("radio", { name: "Recibo" }).click();
  await dialog.getByRole("radio", { name: "Vermelho" }).click();
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(moradia.getByText("Imposto da casa")).toBeVisible();

  await page.getByRole("button", { name: "Editar Imposto da casa" }).click();
  await expect(dialog.getByRole("radio", { name: "Recibo" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(dialog.getByRole("radio", { name: "Vermelho" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");

  // Arquivar tira da lista; "Mostrar arquivadas" traz de volta, esmaecida.
  await page.getByRole("button", { name: "Arquivar Imposto da casa" }).click();
  await expect(moradia.getByText("Imposto da casa")).toBeHidden();
  await page.getByLabel("Mostrar arquivadas").click();
  const archived = moradia.getByRole("listitem").filter({ hasText: "Imposto da casa" });
  await expect(archived.getByText("Arquivada")).toBeVisible();
  await archived.getByRole("button", { name: "Desarquivar Imposto da casa" }).click();
  await expect(archived.getByText("Arquivada")).toBeHidden();

  // Receitas ficam na outra aba e não têm a opção de fixa.
  await page.getByRole("tab", { name: "Receitas" }).click();
  await expect(page.getByText("Salário")).toBeVisible();
  await page.getByRole("button", { name: "Editar Salário" }).click();
  await expect(dialog.getByLabel("Gasto fixo")).toHaveCount(0);
});
