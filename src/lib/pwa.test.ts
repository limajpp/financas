import { describe, expect, it } from "vitest";

import { isPrivateCache } from "./pwa";

describe("isPrivateCache", () => {
  it("as telas guardadas e as respostas da API são privadas", () => {
    for (const name of ["pages", "pages-rsc", "pages-rsc-prefetch", "apis", "others"]) {
      expect(isPrivateCache(name), name).toBe(true);
    }
  });

  it("o precache e os arquivos estáticos ficam", () => {
    for (const name of [
      "serwist-precache-v2-https://app.example/",
      "static-font-assets",
      "next-static-js-assets",
      "static-style-assets",
      "static-image-assets",
    ]) {
      expect(isPrivateCache(name), name).toBe(false);
    }
  });
});
