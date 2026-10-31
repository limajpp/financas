import { afterEach, describe, expect, it, vi } from "vitest";

import { isSignUpAllowed } from "./signup-allowlist";

afterEach(() => vi.unstubAllEnvs());

describe("isSignUpAllowed", () => {
  it("libera qualquer e-mail quando a lista não está definida", () => {
    vi.stubEnv("SIGNUP_ALLOWED_EMAILS", "");
    expect(isSignUpAllowed("qualquer@example.com")).toBe(true);
  });

  it("libera só os e-mails da lista, sem diferença de maiúsculas e espaços", () => {
    vi.stubEnv("SIGNUP_ALLOWED_EMAILS", " ana@example.com , Bia@Example.com ");
    expect(isSignUpAllowed("ana@example.com")).toBe(true);
    expect(isSignUpAllowed("BIA@example.com")).toBe(true);
    expect(isSignUpAllowed("outra@example.com")).toBe(false);
  });

  it("não aceita e-mail que só contém um da lista", () => {
    vi.stubEnv("SIGNUP_ALLOWED_EMAILS", "ana@example.com");
    expect(isSignUpAllowed("xana@example.com")).toBe(false);
    expect(isSignUpAllowed("ana@example.com.evil")).toBe(false);
  });
});
