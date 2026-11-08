import { describe, expect, it } from "vitest";

import { isPrivateCache } from "./pwa";

describe("isPrivateCache", () => {
  it("as telas guardadas e as respostas da API são privadas; o precache fica", () => {
    expect(isPrivateCache("pages")).toBe(true);
    expect(isPrivateCache("pages-rsc")).toBe(true);
    expect(isPrivateCache("apis")).toBe(true);
    expect(isPrivateCache("serwist-precache-v2-https://app.example/")).toBe(false);
  });
});
