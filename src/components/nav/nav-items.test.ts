import { describe, expect, it } from "vitest";

import { isActive } from "./nav-items";

describe("isActive", () => {
  it("a home só fica ativa nela mesma", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/", "/lancamentos")).toBe(false);
  });

  it("uma seção fica ativa nela e nas subpáginas", () => {
    expect(isActive("/contas", "/contas")).toBe(true);
    expect(isActive("/contas", "/contas/nova")).toBe(true);
  });

  it("não confunde prefixos parecidos", () => {
    expect(isActive("/contas", "/contasx")).toBe(false);
  });
});
