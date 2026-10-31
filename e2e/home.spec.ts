import { expect, test } from "@playwright/test";

test("login page shows the app name in Portuguese", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));

  await page.goto("/entrar");

  await expect(page).toHaveTitle(/Finanças/);
  await expect(page.getByRole("heading", { level: 1, name: "Finanças" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  expect(errors).toEqual([]);
});
