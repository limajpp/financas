/**
 * What the app learns per counterparty: the category and description to suggest, the aliases
 * (names the bank shows) and which counterparty a typed text means. Pure functions only.
 * Spec: docs/specs/tasks/10-counterparty-memory.md.
 */
import { documentKey } from "./document";
import { normalizeName } from "./names";

export const MAX_ALIASES = 10;
export const ALIAS_MAX = 60;

export type Suggestion = { categoryId: string | null; description: string | null };

/**
 * The suggestion for one entry type: the explicit defaults (task 20) when set and usable, else
 * the most used category of that type (ties: the most recent) and the latest description.
 * `selectable` are the active categories of that type: nothing else is suggested.
 */
export function suggestionFor(
  memory: {
    defaultCategoryId: string | null;
    defaultDescription: string | null;
    categoryUsage: readonly { categoryId: string; count: number; lastUsedAt: Date }[];
    lastDescription: string | null;
  },
  selectable: ReadonlySet<string>,
): Suggestion {
  const learned = memory.categoryUsage
    .filter((u) => selectable.has(u.categoryId))
    .sort((a, b) => b.count - a.count || b.lastUsedAt.getTime() - a.lastUsedAt.getTime())[0];
  const explicit =
    memory.defaultCategoryId !== null && selectable.has(memory.defaultCategoryId)
      ? memory.defaultCategoryId
      : null;
  return {
    categoryId: explicit ?? learned?.categoryId ?? null,
    description: memory.defaultDescription ?? memory.lastDescription,
  };
}

/**
 * `aliases` plus `alias`, unless it's already there (compared without case and accents). Keeps
 * at most MAX_ALIASES: past that the oldest goes, since the newest is what the bank shows today.
 */
export function addAlias(aliases: readonly string[], alias: string): string[] {
  const value = alias.trim();
  if (value === "") return [...aliases];
  const key = normalizeName(value);
  if (aliases.some((a) => normalizeName(a) === key)) return [...aliases];
  return [...aliases, value].slice(-MAX_ALIASES);
}

type Resolvable = { id: string; name: string; aliases: readonly string[]; document: string | null };

/**
 * Which counterparty a typed text means: the one with that name; else the only one with exactly
 * that alias; else the only one with that CPF/CNPJ. Null means a new counterparty (also when two
 * share the alias or document: no guessing).
 */
export function resolveCounterparty(text: string, counterparties: readonly Resolvable[]) {
  const key = normalizeName(text);
  const byName = counterparties.find((c) => normalizeName(c.name) === key);
  if (byName) return byName.id;

  const only = (matches: Resolvable[]) => (matches.length === 1 ? matches[0]!.id : null);
  const byAlias = counterparties.filter((c) => c.aliases.some((a) => normalizeName(a) === key));
  if (byAlias.length > 0) return only(byAlias);

  const document = documentKey(text);
  if (document.length < 11) return null;
  return only(counterparties.filter((c) => c.document === document));
}
