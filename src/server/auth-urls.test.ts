import { describe, expect, it } from "vitest";

import { authUrls } from "./auth-urls";

describe("authUrls", () => {
  it("usa BETTER_AUTH_URL quando definida (dev, CI)", () => {
    expect(authUrls({ BETTER_AUTH_URL: "http://localhost:3000" })).toEqual({
      baseURL: "http://localhost:3000",
      trustedOrigins: [],
    });
  });

  it("ignora BETTER_AUTH_URL vazia", () => {
    expect(
      authUrls({ BETTER_AUTH_URL: "", VERCEL_ENV: "preview", VERCEL_URL: "p-1.vercel.app" })
        .baseURL,
    ).toBe("https://p-1.vercel.app");
  });

  it("em produção usa o domínio de produção e confia também na URL do deploy", () => {
    expect(
      authUrls({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "financas.vercel.app",
        VERCEL_URL: "financas-abc123.vercel.app",
        VERCEL_BRANCH_URL: "financas-git-main.vercel.app",
      }),
    ).toEqual({
      baseURL: "https://financas.vercel.app",
      trustedOrigins: [
        "https://financas.vercel.app",
        "https://financas-abc123.vercel.app",
        "https://financas-git-main.vercel.app",
      ],
    });
  });

  it("no preview usa a URL do deploy e confia na URL da branch", () => {
    expect(
      authUrls({
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "financas.vercel.app",
        VERCEL_URL: "financas-xyz.vercel.app",
        VERCEL_BRANCH_URL: "financas-git-task.vercel.app",
      }),
    ).toEqual({
      baseURL: "https://financas-xyz.vercel.app",
      trustedOrigins: ["https://financas-xyz.vercel.app", "https://financas-git-task.vercel.app"],
    });
  });

  it("sem nada definido, deixa o Better Auth decidir", () => {
    expect(authUrls({})).toEqual({ baseURL: undefined, trustedOrigins: [] });
  });
});
