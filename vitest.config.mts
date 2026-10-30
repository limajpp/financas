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
        test: { name: "domain", include: ["src/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: { name: "ui", include: ["src/**/*.test.tsx"], environment: "jsdom" },
      },
    ],
  },
});
