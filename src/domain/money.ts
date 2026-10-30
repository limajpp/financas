const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Formats an amount in cents as Brazilian reais, e.g. 4790 → "R$ 47,90". */
export function formatBRL(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`Amount must be an integer number of cents, got ${cents}`);
  }
  return brl.format(cents / 100);
}
