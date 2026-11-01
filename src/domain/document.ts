/**
 * CPF and CNPJ. Pure functions only.
 *
 * - CPF: 11 digits; two mod-11 check digits.
 * - CNPJ: 14 characters. Since July 2026 the first 12 may be letters (alphanumeric CNPJ); the
 *   last 2 are check digits. Each character counts as its ASCII code − 48 (digits stay 0–9,
 *   A = 17 …), with the classic weights; a numeric CNPJ is the same computation.
 *
 * Normalized form: uppercase letters and digits only.
 */

export type DocumentError = "INVALID_CPF" | "INVALID_CNPJ" | "INVALID_LENGTH";

export const DOCUMENT_ERROR_MESSAGES: Record<DocumentError, string> = {
  INVALID_CPF: "CPF inválido. Confira os números.",
  INVALID_CNPJ: "CNPJ inválido. Confira os caracteres.",
  INVALID_LENGTH: "Informe um CPF (11 dígitos) ou um CNPJ (14 caracteres).",
};

/** Punctuation people type in documents. Anything else (other than letters/digits) is invalid. */
const PUNCTUATION = /[\s./-]/g;

/** Letters and digits only, uppercase: how documents are compared and stored. */
export function documentKey(text: string): string {
  return text.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

const value = (char: string) => char.charCodeAt(0) - 48;

function cpfCheckDigit(base: string): number {
  const weight = base.length + 1;
  const sum = [...base].reduce((total, char, i) => total + Number(char) * (weight - i), 0);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

function isCpf(document: string): boolean {
  if (!/^\d{11}$/.test(document) || /^(\d)\1{10}$/.test(document)) return false;
  const first = cpfCheckDigit(document.slice(0, 9));
  const second = cpfCheckDigit(document.slice(0, 9) + first);
  return document.endsWith(`${first}${second}`);
}

const CNPJ_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function cnpjCheckDigit(base: string): number {
  const weights = CNPJ_WEIGHTS.slice(CNPJ_WEIGHTS.length - base.length);
  const rest = [...base].reduce((total, char, i) => total + value(char) * weights[i]!, 0) % 11;
  return rest < 2 ? 0 : 11 - rest;
}

function isCnpj(document: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(document) || /^(.)\1{13}$/.test(document)) return false;
  const first = cnpjCheckDigit(document.slice(0, 12));
  const second = cnpjCheckDigit(document.slice(0, 12) + first);
  return document.endsWith(`${first}${second}`);
}

/** A CPF or CNPJ as typed → normalized, or why it isn't one. */
export function parseDocument(
  text: string,
): { ok: true; document: string } | { ok: false; error: DocumentError } {
  const document = text.toUpperCase().replace(PUNCTUATION, "");
  if (!/^[0-9A-Z]*$/.test(document)) return { ok: false, error: "INVALID_LENGTH" };
  if (document.length === 11) {
    return isCpf(document) ? { ok: true, document } : { ok: false, error: "INVALID_CPF" };
  }
  if (document.length === 14) {
    return isCnpj(document) ? { ok: true, document } : { ok: false, error: "INVALID_CNPJ" };
  }
  return { ok: false, error: "INVALID_LENGTH" };
}

/** A normalized document for display: 529.982.247-25, 12.ABC.345/01DE-35. */
export function formatDocument(document: string): string {
  if (document.length === 11) {
    return `${document.slice(0, 3)}.${document.slice(3, 6)}.${document.slice(6, 9)}-${document.slice(9)}`;
  }
  if (document.length === 14) {
    return `${document.slice(0, 2)}.${document.slice(2, 5)}.${document.slice(5, 8)}/${document.slice(8, 12)}-${document.slice(12)}`;
  }
  return document;
}
