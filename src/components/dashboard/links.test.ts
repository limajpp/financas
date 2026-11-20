import { describe, expect, it } from "vitest";

import { categoryEntriesHref, insightHref, monthHref } from "./links";

describe("os links do dashboard", () => {
  it("uma categoria leva aos lançamentos dela no mês; sem categoria, aos sem categoria", () => {
    expect(categoryEntriesHref("abc", "2026-10")).toBe(
      "/lancamentos?categoria=abc&de=2026-10-01&ate=2026-10-31",
    );
    expect(categoryEntriesHref(null, "2026-11")).toBe(
      "/lancamentos?categoria=none&de=2026-11-01&ate=2026-11-30",
    );
  });

  it("cada insight leva ao seu assunto", () => {
    expect(insightHref({ type: "category", id: "abc" }, "2026-11")).toBe(
      "/lancamentos?categoria=abc&de=2026-11-01&ate=2026-11-30",
    );
    expect(insightHref({ type: "counterparty", id: "xyz" }, "2026-11")).toBe(
      "/estabelecimentos/xyz",
    );
    expect(insightHref({ type: "subscription", id: "s" }, "2026-11")).toBe("/assinaturas");
    expect(insightHref({ type: "subscriptions" }, "2026-11")).toBe("/assinaturas");
  });

  it("o mês atual é a raiz; outro mês vai no parâmetro", () => {
    expect(monthHref("2026-11", true)).toBe("/");
    expect(monthHref("2026-10", false)).toBe("/?mes=2026-10");
  });
});
