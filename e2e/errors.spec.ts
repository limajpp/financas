import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { signUp } from "./helpers";

test("CA2: um endereço que não existe mostra a página não encontrada, com o caminho de volta", async ({
  page,
}) => {
  await signUp(page);
  const response = await page.goto("/nao-existe");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Página não encontrada" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Ir para o início" }).click();
  await expect(page.getByRole("heading", { name: /^Olá/ }).first()).toBeVisible();
});

test("CA2: um estabelecimento e uma fatura que não são do espaço dizem que não foram encontrados", async ({
  page,
}) => {
  await signUp(page);
  await page.goto(`/estabelecimentos/${randomUUID()}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Estabelecimento não encontrado" }),
  ).toBeVisible();
  await page.goto(`/faturas/${randomUUID()}/2026-12-10`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Fatura não encontrada" }),
  ).toBeVisible();
});
