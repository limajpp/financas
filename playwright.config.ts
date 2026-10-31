import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // The dev server stalls when several browsers make it compile pages at once (seen in WebKit).
  workers: process.env.CI ? undefined : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // The dev server compiles each page on first visit; the production build (CI) doesn't need the slack.
  expect: { timeout: process.env.CI ? 5_000 : 15_000 },
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The app's main target is Safari on the iPhone.
    { name: "webkit", use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    // CI tests the production build; locally the dev server is enough.
    command: process.env.CI ? "npm run start" : "npm run dev",
    // Many sign-ups from one IP in a few seconds: Better Auth's rate limit would block them.
    env: { AUTH_RATE_LIMIT: "off" },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
