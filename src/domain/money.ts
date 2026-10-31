const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  // Hides the sign of -0 (e.g. a negated zero expense).
  signDisplay: "negative",
});

/** Formats an amount in cents as Brazilian reais, e.g. 4790 → "R$ 47,90". */
export function formatBRL(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`Amount must be an integer number of cents, got ${cents}`);
  }
  return brl.format(cents / 100);
}

/** Largest absolute amount the app accepts: R$ 20.000.000,00 (fits Postgres Int with room). */
export const MAX_AMOUNT_CENTS = 2_000_000_000;

// Optional sign, then digits (dots only as thousands separators, in groups of 3),
// then an optional comma with 1–2 decimal digits.
// No two adjacent \s* around an optional group: that backtracks quadratically on long input.
const BRL_PATTERN = /^([-−])?\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/** Longest text parseBRL looks at; anything longer isn't an amount. */
export const MAX_AMOUNT_TEXT = 30;

/**
 * Reads an amount typed in Brazilian format and returns it in cents, or null if it isn't one.
 * "1.234,56" → 123456, "0,5" → 50, "R$ 1.234" → 123400, "-50" → -5000. "12.5" → null.
 */
export function parseBRL(input: string): number | null {
  if (input.length > MAX_AMOUNT_TEXT * 4) return null;
  const match = BRL_PATTERN.exec(input.trim().replace(/^R\$\s*([-−])/, "$1R$"));
  if (!match) return null;
  const [, sign, integerPart, decimals = ""] = match;
  const cents = Number(integerPart!.replaceAll(".", "")) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return null;
  // `0 * -1` is -0; keep zero unsigned.
  return sign && cents !== 0 ? -cents : cents;
}

const inputFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** The amount as an input field shows it, without "R$": 123456 → "1.234,56". */
export function formatBRLInput(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`Amount must be an integer number of cents, got ${cents}`);
  }
  return (cents < 0 ? "-" : "") + inputFormat.format(Math.abs(cents) / 100);
}
