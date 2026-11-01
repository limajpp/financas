/**
 * The register screen's keypad. The amount is typed in cents, as in banking apps: each digit
 * enters from the right ("4790" → R$ 47,90). Pure functions only.
 */
import { MAX_AMOUNT_CENTS } from "./money";

export const KEYPAD_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;
export type KeypadKey = (typeof KEYPAD_DIGITS)[number] | "00" | "backspace";

/** The amount after pressing `key`. A key that would pass the cap is ignored. */
export function pressKey(cents: number, key: KeypadKey): number {
  if (key === "backspace") return Math.floor(cents / 10);
  const next = key === "00" ? cents * 100 : cents * 10 + Number(key);
  return next > MAX_AMOUNT_CENTS ? cents : next;
}
