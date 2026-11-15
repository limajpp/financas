import { describe, expect, it } from "vitest";

import { pushSubscriptionSchema } from "./push";

const keys = { p256dh: "BNcR", auth: "tBHI" };

describe("pushSubscriptionSchema", () => {
  it("aceita os serviços de push dos navegadores", () => {
    for (const endpoint of [
      "https://web.push.apple.com/QGuQyavXutnMgOkx",
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ]) {
      expect(pushSubscriptionSchema.safeParse({ endpoint, keys }).success, endpoint).toBe(true);
    }
  });

  it("recusa outros endereços, http e chaves vazias", () => {
    for (const endpoint of [
      "http://web.push.apple.com/x",
      "https://localhost:3000/x",
      "https://169.254.169.254/latest",
      "https://push.apple.com.evil.example/x",
      "https://user:pw@web.push.apple.com/x",
      // Percent-encoded dots: another host for Node's legacy parser, which web-push uses.
      "https://evil.com%2Epush.apple.com/x",
      "https://127.0.0.1%2epush.apple.com/x",
      "https://localhost%2Ewns.notify.windows.com/x",
      "https://web.push.apple.com:8443/x",
      "https://web.push.apple.com./x",
      "nada",
    ]) {
      expect(pushSubscriptionSchema.safeParse({ endpoint, keys }).success, endpoint).toBe(false);
    }
    expect(
      pushSubscriptionSchema.safeParse({
        endpoint: "https://web.push.apple.com/x",
        keys: { p256dh: "", auth: "a" },
      }).success,
    ).toBe(false);
  });
});
