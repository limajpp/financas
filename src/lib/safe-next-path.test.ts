import { describe, expect, it } from "vitest";

import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it.each(["/lancamentos", "/contas?x=1", "/faturas#topo", "/"])(
    "aceita o caminho interno %s",
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "lancamentos",
    "javascript:alert(1)",
    "",
  ])("recusa %s e volta para /", (path) => {
    expect(safeNextPath(path)).toBe("/");
  });

  it("volta para / quando não é texto", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(42)).toBe("/");
  });
});
