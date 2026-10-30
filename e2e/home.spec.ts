import { expect, test } from "@playwright/test";

test("home shows the app name in Portuguese", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Finanças/);
  await expect(page.getByRole("heading", { level: 1, name: "Finanças" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
});
