/** Comparison key for user-given names: no accents, no case, single spaces. "  Saúde " → "saude". */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
