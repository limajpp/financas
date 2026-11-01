/**
 * The "O que foi?" autocomplete: finds counterparties by name, alias or CPF/CNPJ. Pure; runs on
 * the device over the list the register screen loads. Spec: docs/specs/tasks/10-counterparty-memory.md.
 */
import { documentKey, formatDocument } from "./document";
import { normalizeName } from "./names";

export type SearchableCounterparty = {
  id: string;
  name: string;
  aliases: string[];
  /** Normalized CPF/CNPJ. */
  document: string | null;
  useCount: number;
  /** Entries in the last 90 days: the shortcuts for an empty query. */
  recentCount: number;
  /** Epoch milliseconds (serializable). */
  lastUsedAt: number;
};

export type CounterpartyMatch = { field: "name" | "alias" | "document"; text: string };

export type SearchResult<T extends SearchableCounterparty> = {
  counterparty: T;
  match: CounterpartyMatch;
};

/** Below this many digits, a query doesn't search documents (it would match almost anything). */
const MIN_DOCUMENT_DIGITS = 3;

/**
 * Lower is better: starts-with before contains; the name before an alias, an alias before the
 * document.
 */
function bestMatch(
  counterparty: SearchableCounterparty,
  text: string,
  docQuery: string | null,
): { rank: number; match: CounterpartyMatch } | null {
  let best: { rank: number; match: CounterpartyMatch } | null = null;
  const consider = (rank: number, match: CounterpartyMatch) => {
    if (!best || rank < best.rank) best = { rank, match };
  };

  const name = normalizeName(counterparty.name);
  if (name.startsWith(text)) consider(0, { field: "name", text: counterparty.name });
  else if (name.includes(text)) consider(2, { field: "name", text: counterparty.name });

  for (const alias of counterparty.aliases) {
    const key = normalizeName(alias);
    if (key.startsWith(text)) consider(1, { field: "alias", text: alias });
    else if (key.includes(text)) consider(3, { field: "alias", text: alias });
    // Digits inside an alias ("PAG*JOSE 12.345.678/0001-95") match like a document.
    else if (docQuery && documentKey(alias).includes(docQuery)) {
      consider(3, { field: "alias", text: alias });
    }
  }

  if (docQuery && counterparty.document) {
    const shown = formatDocument(counterparty.document);
    if (counterparty.document.startsWith(docQuery)) consider(4, { field: "document", text: shown });
    else if (counterparty.document.includes(docQuery)) {
      consider(5, { field: "document", text: shown });
    }
  }
  return best;
}

/**
 * Up to `limit` counterparties matching `query`, best first; ties go to the most used, then the
 * most recently used. An empty query lists the most used in the last 90 days.
 */
export function searchCounterparties<T extends SearchableCounterparty>(
  query: string,
  counterparties: readonly T[],
  limit = 5,
): SearchResult<T>[] {
  const text = normalizeName(query);
  if (text === "") {
    return counterparties
      .filter((c) => c.recentCount > 0)
      .sort((a, b) => b.recentCount - a.recentCount || b.lastUsedAt - a.lastUsedAt)
      .slice(0, limit)
      .map((counterparty) => ({ counterparty, match: { field: "name", text: counterparty.name } }));
  }

  // Only punctuation: nothing to look for. Letters of any alphabet count ("é", "ç").
  if (!/[\p{L}\p{N}]/u.test(text)) return [];
  const key = documentKey(query);
  const digits = key.replace(/\D/g, "").length;
  const docQuery = digits >= MIN_DOCUMENT_DIGITS ? key : null;

  return counterparties
    .flatMap((counterparty) => {
      const found = bestMatch(counterparty, text, docQuery);
      return found ? [{ counterparty, ...found }] : [];
    })
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.counterparty.useCount - a.counterparty.useCount ||
        b.counterparty.lastUsedAt - a.counterparty.lastUsedAt,
    )
    .slice(0, limit)
    .map(({ counterparty, match }) => ({ counterparty, match }));
}
