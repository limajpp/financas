import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        // Domain rules are pure functions: no DOM.
        extends: true,
        test: { name: "domain", include: ["src/domain/**/*.test.ts"], environment: "node" },
      },
      {
        // Everything else (components, hooks, browser-side libs) gets a DOM.
        extends: true,
        test: {
          name: "ui",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/domain/**"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
