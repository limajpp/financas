import { afterEach, describe, expect, it, vi } from "vitest";

import { applicationServerKey, sameServerKey, subscriptionToForget } from "./push-client";

const KEY =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

function fakeSubscription(key = KEY) {
  return {
    endpoint: "https://web.push.apple.com/x",
    options: { applicationServerKey: applicationServerKey(key).buffer },
  } as unknown as PushSubscription;
}

function stubPush(subscription: PushSubscription | null | Promise<never>) {
  const getSubscription = vi.fn(() => subscription);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => ({ pushManager: { getSubscription } }) },
  });
  return getSubscription;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("subscriptionToForget", () => {
  it("sem a permissão, nem consulta o push", async () => {
    vi.stubGlobal("Notification", { permission: "denied" });
    const getSubscription = stubPush(fakeSubscription());
    expect(await subscriptionToForget()).toBeNull();
    expect(getSubscription).not.toHaveBeenCalled();
  });

  it("com a permissão, devolve a inscrição deste aparelho", async () => {
    vi.stubGlobal("Notification", { permission: "granted" });
    const subscription = fakeSubscription();
    stubPush(subscription);
    expect(await subscriptionToForget()).toBe(subscription);
  });

  it("um push que não responde não segura a saída: desiste em 3 s", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Notification", { permission: "granted" });
    stubPush(new Promise<never>(() => {}));
    const result = subscriptionToForget();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await result).toBeNull();
  });
});

describe("sameServerKey", () => {
  it("reconhece a inscrição feita com a chave atual e a de uma chave antiga", () => {
    expect(sameServerKey(fakeSubscription(), KEY)).toBe(true);
    const other =
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
    expect(sameServerKey(fakeSubscription(other), KEY)).toBe(false);
  });
});
