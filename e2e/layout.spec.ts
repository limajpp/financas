import { expect, test } from "@playwright/test";

import { signUp } from "./helpers";

test("navegação: sidebar no desktop, barra inferior no celular", async ({ page, isMobile }) => {
  await signUp(page);

  const sidebar = page.getByRole("navigation", { name: "Navegação principal" });
  const bottomNav = page.getByRole("navigation", { name: "Navegação inferior" });

  if (isMobile) {
    await expect(bottomNav).toBeVisible();
    await expect(sidebar).toBeHidden();
  } else {
    await expect(sidebar).toBeVisible();
    await expect(bottomNav).toBeHidden();
  }
});

test("o item da seção atual fica marcado", async ({ page, isMobile }) => {
  await signUp(page);
  const nav = page.getByRole("navigation", {
    name: isMobile ? "Navegação inferior" : "Navegação principal",
  });

  await nav.getByRole("link", { name: "Lançamentos" }).click();

  await expect(page).toHaveURL(/\/lancamentos$/);
  await expect(nav.getByRole("link", { name: "Lançamentos" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { level: 1, name: "Lançamentos" })).toBeVisible();
});
