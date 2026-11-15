import { describe, expect, it } from "vitest";

import { availabilityMessage, reminderAvailability } from "./reminder-availability";

const ready = {
  hasKeys: true,
  production: true,
  isIos: false,
  standalone: false,
  hasPushApi: true,
  permission: "default" as NotificationPermission,
};

describe("reminderAvailability", () => {
  it("pronto num navegador com push e chaves", () => {
    expect(reminderAvailability(ready)).toBe("READY");
    expect(reminderAvailability({ ...ready, isIos: true, standalone: true })).toBe("READY");
  });

  it("sem chaves ou sem service worker (dev): indisponível", () => {
    expect(reminderAvailability({ ...ready, hasKeys: false })).toBe("UNAVAILABLE");
    expect(reminderAvailability({ ...ready, production: false })).toBe("UNAVAILABLE");
  });

  it("no iPhone, só com o app instalado", () => {
    // Safari on iOS before installing has no PushManager: the install message comes first.
    expect(
      reminderAvailability({ ...ready, isIos: true, standalone: false, hasPushApi: false }),
    ).toBe("IOS_NOT_INSTALLED");
  });

  it("sem push no navegador, ou com a permissão negada", () => {
    expect(reminderAvailability({ ...ready, hasPushApi: false })).toBe("UNSUPPORTED");
    expect(reminderAvailability({ ...ready, permission: "denied" })).toBe("DENIED");
  });

  it("explica onde liberar, conforme o aparelho", () => {
    expect(availabilityMessage("DENIED", true)).toContain("Ajustes › Notificações › Finanças");
    expect(availabilityMessage("DENIED", false)).toContain("configurações do navegador");
    expect(availabilityMessage("READY", false)).toBeNull();
  });
});
