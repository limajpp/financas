import { describe, expect, it } from "vitest";

import { vapidDetailsFrom } from "./vapid";

const keys = { VAPID_PUBLIC_KEY: "publica", VAPID_PRIVATE_KEY: "privada" };

describe("vapidDetailsFrom", () => {
  it("na Vercel, o remetente é o domínio de produção ou a URL do preview", () => {
    expect(
      vapidDetailsFrom({
        ...keys,
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "financas.example.com",
        VERCEL_URL: "financas-abc.vercel.app",
      })?.subject,
    ).toBe("https://financas.example.com");
    expect(
      vapidDetailsFrom({ ...keys, VERCEL_ENV: "preview", VERCEL_URL: "financas-abc.vercel.app" })
        ?.subject,
    ).toBe("https://financas-abc.vercel.app");
  });

  it("VAPID_SUBJECT tem precedência", () => {
    expect(
      vapidDetailsFrom({ ...keys, VAPID_SUBJECT: "https://outro.example", VERCEL_URL: "x.app" })
        ?.subject,
    ).toBe("https://outro.example");
    // Only the origin, whatever path came with it.
    expect(
      vapidDetailsFrom({ ...keys, VAPID_SUBJECT: "https://outro.example/app?x=1" })?.subject,
    ).toBe("https://outro.example");
  });

  it("sem chaves, sem URL, com http ou localhost: indisponível", () => {
    expect(vapidDetailsFrom({ VERCEL_URL: "x.vercel.app" })).toBeNull();
    expect(vapidDetailsFrom({ ...keys })).toBeNull();
    expect(vapidDetailsFrom({ ...keys, BETTER_AUTH_URL: "http://localhost:3000" })).toBeNull();
    expect(vapidDetailsFrom({ ...keys, VAPID_SUBJECT: "https://localhost" })).toBeNull();
    expect(vapidDetailsFrom({ ...keys, VAPID_SUBJECT: "mailto:alguem@example.com" })).toBeNull();
    expect(vapidDetailsFrom({ ...keys, VAPID_SUBJECT: "" })).toBeNull();
  });
});
