import { expect, test } from "@playwright/test";

import { signUp, visit } from "./helpers";

test("CA3: com uma conta nova, as telas dizem o que falta e oferecem o próximo passo", async ({
  page,
}) => {
  await signUp(page);
  const main = page.getByRole("main");

  // Entries: nothing yet, so registering; with a filter, clearing it.
  await visit(page, "/lancamentos");
  await expect(main.getByText("Nenhum lançamento neste período.")).toBeVisible();
  await expect(main.getByRole("link", { name: "Registrar um lançamento" })).toHaveAttribute(
    "href",
    "/registrar",
  );
  await visit(page, "/lancamentos?q=nada");
  await expect(main.getByText("Nenhum lançamento neste período.")).toBeVisible();
  await expect(main.getByRole("button", { name: "Limpar filtros" })).toBeVisible();

  // Counterparties: how one comes to be, and the way to register.
  await visit(page, "/estabelecimentos");
  await expect(main.getByText("Nenhuma despesa com estabelecimento neste período.")).toBeVisible();
  await expect(main.getByText(/diga onde foi em “O que foi\?”/)).toBeVisible();
  await expect(main.getByRole("link", { name: "Registrar um gasto" })).toHaveAttribute(
    "href",
    "/registrar",
  );

  // Accounts and cards.
  await visit(page, "/contas");
  await expect(main.getByText(/^Nenhuma conta ainda\./)).toBeVisible();
  await expect(main.getByRole("button", { name: "Nova conta" })).toBeVisible();
  await expect(main.getByText(/^Nenhum cartão ainda\./)).toBeVisible();

  // The register without an account sends to the accounts.
  await visit(page, "/registrar");
  await expect(main.getByText("Cadastre uma conta para começar a registrar.")).toBeVisible();
  await expect(main.getByRole("link", { name: "Ir para Contas" })).toBeVisible();
});
