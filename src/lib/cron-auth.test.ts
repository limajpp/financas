import { describe, expect, it } from "vitest";

import { isCronAuthorized } from "./cron-auth";

describe("isCronAuthorized", () => {
  it("só passa com o segredo certo", () => {
    expect(isCronAuthorized("Bearer segredo-de-teste", "segredo-de-teste")).toBe(true);
    expect(isCronAuthorized("Bearer outro", "segredo-de-teste")).toBe(false);
    expect(isCronAuthorized("segredo-de-teste", "segredo-de-teste")).toBe(false);
    expect(isCronAuthorized(null, "segredo-de-teste")).toBe(false);
  });

  it("sem segredo configurado, nada passa", () => {
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
  });
});
