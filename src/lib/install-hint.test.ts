import { describe, expect, it } from "vitest";

import { INSTALL_HINT_SNOOZE_MS, isIosSafari, shouldShowInstallHint } from "./install-hint";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1";
const IPHONE_IN_APP =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IPAD_DESKTOP_MODE =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const DESKTOP_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const NOW = Date.UTC(2026, 10, 8, 12);
const base = {
  userAgent: IPHONE_SAFARI,
  maxTouchPoints: 5,
  standalone: false,
  dismissedAt: null,
  now: NOW,
};

describe("isIosSafari", () => {
  it("reconhece o Safari do iPhone e do iPad em modo desktop", () => {
    expect(isIosSafari(IPHONE_SAFARI, 5)).toBe(true);
    expect(isIosSafari(IPAD_DESKTOP_MODE, 5)).toBe(true);
  });

  it("recusa outros navegadores, navegadores dentro de apps e o Mac", () => {
    expect(isIosSafari(IPHONE_CHROME, 5)).toBe(false);
    expect(isIosSafari(IPHONE_IN_APP, 5)).toBe(false);
    expect(isIosSafari(IPAD_DESKTOP_MODE, 0)).toBe(false);
    expect(isIosSafari(DESKTOP_CHROME, 0)).toBe(false);
  });
});

describe("shouldShowInstallHint", () => {
  it("aparece no Safari do iPhone fora do modo instalado", () => {
    expect(shouldShowInstallHint(base)).toBe(true);
  });

  it("não aparece com o app instalado nem em outro navegador", () => {
    expect(shouldShowInstallHint({ ...base, standalone: true })).toBe(false);
    expect(shouldShowInstallHint({ ...base, userAgent: IPHONE_CHROME })).toBe(false);
    expect(shouldShowInstallHint({ ...base, userAgent: DESKTOP_CHROME, maxTouchPoints: 0 })).toBe(
      false,
    );
  });

  it('"Agora não" esconde por 30 dias', () => {
    expect(shouldShowInstallHint({ ...base, dismissedAt: NOW - 1000 })).toBe(false);
    expect(shouldShowInstallHint({ ...base, dismissedAt: NOW - INSTALL_HINT_SNOOZE_MS + 1 })).toBe(
      false,
    );
    expect(shouldShowInstallHint({ ...base, dismissedAt: NOW - INSTALL_HINT_SNOOZE_MS })).toBe(
      true,
    );
  });
});
