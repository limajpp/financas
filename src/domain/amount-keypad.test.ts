import { describe, expect, it } from "vitest";

import { type KeypadKey, pressKey } from "./amount-keypad";
import { MAX_AMOUNT_CENTS } from "./money";

const type = (keys: KeypadKey[], start = 0) => keys.reduce(pressKey, start);

describe("pressKey", () => {
  it("digits enter from the right, in cents", () => {
    expect(type(["4", "7", "9", "0"])).toBe(4790);
    expect(type(["5"])).toBe(5);
  });

  it('"00" appends two zeros', () => {
    expect(type(["1", "00"])).toBe(100);
    expect(type(["2", "5", "00", "00"])).toBe(250_000);
  });

  it("leading zeros don't count", () => {
    expect(type(["0", "0", "00", "3"])).toBe(3);
  });

  it("backspace removes the last digit", () => {
    expect(type(["4", "7", "9", "0", "backspace"])).toBe(479);
    expect(type(["backspace"])).toBe(0);
    expect(type(["7", "backspace", "backspace"])).toBe(0);
  });

  it("ignores a key that would pass the cap", () => {
    expect(type(["0"], MAX_AMOUNT_CENTS)).toBe(MAX_AMOUNT_CENTS);
    expect(type(["9"], 200_000_000)).toBe(200_000_000);
    expect(type(["00"], 200_000_000)).toBe(200_000_000);
    expect(type(["0"], 200_000_000)).toBe(2_000_000_000);
    expect(type(["backspace"], MAX_AMOUNT_CENTS)).toBe(200_000_000);
  });
});
