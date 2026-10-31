import { expect, test } from "@playwright/test";

import { formAlert, signIn, signOut, signUp, uniqueEmail } from "./helpers";

test("rota protegida sem sessão vai para o login e volta depois de entrar", async ({ page }) => {
  const { email } = await signUp(page);
  await page.context().clearCookies();

  await page.goto("/lancamentos");
  await expect(page).toHaveURL(/\/entrar\?next=%2Flancamentos$/);

  await signIn(page, email);
  await expect(page).toHaveURL(/\/lancamentos$/);
  await expect(page.getByRole("heading", { level: 1, name: "Lançamentos" })).toBeVisible();
});

test("cadastro → sair → entrar de novo", async ({ page, isMobile }) => {
  const { name, email } = await signUp(page);
  await expect(page).toHaveURL(/\/$/);

  await signOut(page, isMobile);
  await page.goto("/");
  await expect(page).toHaveURL(/\/entrar\?next=%2F$/);

  await signIn(page, email);
  await expect(page.getByRole("heading", { name: `Olá, ${name}` })).toBeVisible();
});

test("senha errada mostra erro genérico", async ({ page, isMobile }) => {
  const { email } = await signUp(page);
  await signOut(page, isMobile);

  await signIn(page, email, "senha-errada-123");

  await expect(formAlert(page)).toHaveText("E-mail ou senha incorretos.");
  await expect(page).toHaveURL(/\/entrar/);
});

test("e-mail repetido no cadastro mostra erro em pt-BR", async ({ page, isMobile }) => {
  const { email } = await signUp(page);
  await signOut(page, isMobile);

  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Outra Pessoa");
  await page.getByLabel("E-mail").fill(email.toUpperCase());
  await page.getByLabel("Senha").fill("outra-senha-123");
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(formAlert(page)).toHaveText("Já existe uma conta com este e-mail.");
});

test("validação do cadastro aparece no campo", async ({ page }) => {
  await page.goto("/cadastro");
  await page.getByLabel("Nome").fill("Ana Teste");
  await page.getByLabel("E-mail").fill(uniqueEmail());
  await page.getByLabel("Senha").fill("curta");
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page.getByText("A senha precisa ter pelo menos 8 caracteres.")).toBeVisible();
});

test("quem já está logado e abre /entrar vai para a home", async ({ page }) => {
  const { name } = await signUp(page);

  await page.goto("/entrar");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: `Olá, ${name}` })).toBeVisible();
});
