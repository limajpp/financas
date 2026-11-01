/**
 * What a memory suggestion fills on the register screen, and how it's undone. A field still
 * holding what the last pick put there is the pick's, not the user's: a new pick replaces it,
 * and leaving the pick (the text no longer is its name) clears it. Without this, a CPF/CNPJ filled
 * by one counterparty would be saved on another.
 */

export type PrefillFields = { categoryId: string | null; description: string; document: string };

/** The picked counterparty's name and what the pick filled (empty where it filled nothing). */
export type Prefill = PrefillFields & { name: string };

const EMPTY: PrefillFields = { categoryId: null, description: "", document: "" };
const KEYS = ["categoryId", "description", "document"] as const;

function filledByPick(fields: PrefillFields, prefill: Prefill | null, key: keyof PrefillFields) {
  return prefill !== null && prefill[key] !== EMPTY[key] && fields[key] === prefill[key];
}

export function applyPick(
  fields: PrefillFields,
  previous: Prefill | null,
  pick: {
    name: string;
    categoryId: string | null;
    description: string | null;
    document: string | null;
  },
): { fields: PrefillFields; prefill: Prefill } {
  const next = { ...fields };
  const filled: PrefillFields = { ...EMPTY };
  for (const key of KEYS) {
    if (fields[key] === EMPTY[key] || filledByPick(fields, previous, key)) {
      const value = pick[key] ?? EMPTY[key];
      // Same type per key; TypeScript can't see it through the loop.
      (next as Record<string, unknown>)[key] = value;
      (filled as Record<string, unknown>)[key] = value;
    }
  }
  return { fields: next, prefill: { name: pick.name, ...filled } };
}

export function leavePick(fields: PrefillFields, prefill: Prefill | null): PrefillFields {
  const next = { ...fields };
  for (const key of KEYS) {
    if (filledByPick(fields, prefill, key)) (next as Record<string, unknown>)[key] = EMPTY[key];
  }
  return next;
}
