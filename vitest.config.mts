import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        // Domain rules are pure functions: no DOM.
        extends: true,
        test: {
          name: "domain",
          include: ["src/domain/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts"],
          environment: "node",
        },
      },
      {
        // Everything else (components, hooks, browser-side libs) gets a DOM.
        extends: true,
        test: {
          name: "ui",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/domain/**", "src/**/*.int.test.ts"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        // Real Postgres (the *_test database). Files run one at a time: they share the database.
        extends: true,
        resolve: {
          alias: {
            "server-only": fileURLToPath(new URL("./src/test/empty-module.ts", import.meta.url)),
          },
        },
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          environment: "node",
          globalSetup: ["./src/test/global-setup.ts"],
          setupFiles: ["./src/test/integration-setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
