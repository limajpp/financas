import { describe, expect, it } from "vitest";

import { parseStep } from "./steps";

describe("parseStep", () => {
  it("lê o passo da URL, de 1 a 4; o resto é o primeiro", () => {
    expect(parseStep("3")).toBe(3);
    expect(parseStep("4")).toBe(4);
    for (const v of [undefined, "", "0", "5", "2.5", "abc", "-1"]) expect(parseStep(v)).toBe(1);
  });
});
