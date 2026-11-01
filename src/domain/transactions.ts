/**
 * Transaction rules. Pure functions only (no Prisma, no I/O).
 * Spec: docs/specs/tasks/08-transactions.md.
 */
import { isArchivedEffective } from "./categories";
import type { CategoryType } from "./categories";
import type { CalendarDate } from "./dates";
import { type CycleVersion, cycleOn, invoiceFor, shiftInvoice } from "./invoice-cycle";

export const TRANSACTION_TYPES = ["EXPENSE", "INCOME", "TRANSFER", "CARD_PAYMENT"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** The types created and edited as an expense or income (transfers and payments: task 11). */
export const ENTRY_TYPES = ["EXPENSE", "INCOME"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const PAYMENT_METHODS = ["PIX", "DEBIT", "CREDIT", "CASH", "BOLETO", "TED"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: "Pix",
  DEBIT: "Débito",
  CREDIT: "Crédito",
  CASH: "Dinheiro",
  BOLETO: "Boleto",
  TED: "TED",
};

/** Credit and debit make no sense for money coming in. */
export const METHODS_BY_TYPE: Record<EntryType, readonly PaymentMethod[]> = {
  EXPENSE: PAYMENT_METHODS,
  INCOME: ["PIX", "TED", "CASH", "BOLETO"],
};

export const TRANSACTION_DATE_MIN: CalendarDate = "2000-01-01";
export const COUNTERPARTY_NAME_MAX = 60;
export const DESCRIPTION_MAX = 120;
/** A manually chosen invoice may be up to this many invoices before or after the computed one. */
export const INVOICE_OVERRIDE_WINDOW = 3;

export type TransactionError =
  | "FUTURE_DATE"
  | "DATE_TOO_OLD"
  | "METHOD_NOT_ALLOWED"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_ARCHIVED"
  | "CARD_NOT_FOUND"
  | "CARD_ARCHIVED"
  | "CATEGORY_NOT_FOUND"
  | "CATEGORY_ARCHIVED"
  | "CATEGORY_TYPE_MISMATCH"
  | "INVALID_INVOICE";

export const TRANSACTION_ERROR_MESSAGES: Record<
  TransactionError | "NOT_FOUND" | "NOT_EDITABLE",
  string
> = {
  NOT_FOUND: "Lançamento não encontrado.",
  NOT_EDITABLE: "Transferências e pagamentos de fatura são editados na tela própria.",
  FUTURE_DATE: "A data não pode estar no futuro.",
  DATE_TOO_OLD: "A data precisa ser de 2000 em diante.",
  METHOD_NOT_ALLOWED: "Uma receita entra por Pix, TED, dinheiro ou boleto.",
  ACCOUNT_NOT_FOUND: "Conta não encontrada.",
  ACCOUNT_ARCHIVED: "Essa conta está arquivada. Escolha outra.",
  CARD_NOT_FOUND: "Cartão não encontrado.",
  CARD_ARCHIVED: "Esse cartão está arquivado. Escolha outro.",
  CATEGORY_NOT_FOUND: "Categoria não encontrada.",
  CATEGORY_ARCHIVED: "Essa categoria está arquivada. Escolha outra.",
  CATEGORY_TYPE_MISMATCH: "Essa categoria não é do mesmo tipo do lançamento.",
  INVALID_INVOICE: "Essa fatura não é deste cartão.",
};

/**
 * An expense or income, as validated by Zod: `accountId` is set unless the method is credit, and
 * then `cardId` is set instead. `invoiceDueDate` is a manual invoice choice (credit only).
 */
export type EntryInput = {
  type: EntryType;
  amountCents: number;
  date: CalendarDate;
  method: PaymentMethod;
  accountId: string | null;
  cardId: string | null;
  invoiceDueDate: CalendarDate | null;
  categoryId: string | null;
  counterparty: string | null;
  /** A name the bank shows for the counterparty, added to its aliases (task 10). */
  counterpartyAlias: string | null;
  /** The counterparty's CPF/CNPJ, normalized (task 10). */
  counterpartyDocument: string | null;
  description: string | null;
};

/** What the entry points to, looked up in the user's space (missing = not found). */
export type EntryRefs = {
  accounts: readonly { id: string; archivedAt: Date | null }[];
  cards: readonly { id: string; archivedAt: Date | null; cycles: readonly CycleVersion[] }[];
  categories: readonly {
    id: string;
    type: CategoryType;
    archivedAt: Date | null;
    parent: { archivedAt: Date | null } | null;
  }[];
};

/**
 * On an edit, what the entry already points to: it may stay even if archived since. A manually
 * chosen invoice may also stay as is while the card and date don't change, even if a later cycle
 * change took it out of the window.
 */
export type CurrentRefs = {
  accountId: string | null;
  cardId: string | null;
  categoryId: string | null;
  date?: CalendarDate;
  invoiceDueDate?: CalendarDate | null;
  invoiceOverridden?: boolean;
};

export type InvoiceChoice = { invoiceDueDate: CalendarDate; invoiceOverridden: boolean };

export type EntryRuleResult =
  { ok: true; invoice: InvoiceChoice | null } | { ok: false; error: TransactionError };

/** Checks an expense or income and, for a credit purchase, picks its invoice. */
export function validateEntry(
  input: EntryInput,
  refs: EntryRefs,
  { today, current }: { today: CalendarDate; current?: CurrentRefs },
): EntryRuleResult {
  // "YYYY-MM-DD" strings compare in calendar order.
  if (input.date > today) return { ok: false, error: "FUTURE_DATE" };
  if (input.date < TRANSACTION_DATE_MIN) return { ok: false, error: "DATE_TOO_OLD" };
  if (!METHODS_BY_TYPE[input.type].includes(input.method)) {
    return { ok: false, error: "METHOD_NOT_ALLOWED" };
  }

  let invoice: InvoiceChoice | null = null;
  if (input.method === "CREDIT") {
    const card = refs.cards.find((c) => c.id === input.cardId);
    if (!card) return { ok: false, error: "CARD_NOT_FOUND" };
    if (card.archivedAt !== null && card.id !== current?.cardId) {
      return { ok: false, error: "CARD_ARCHIVED" };
    }
    const keepsChoice =
      current?.invoiceOverridden === true &&
      current.cardId === card.id &&
      current.date === input.date &&
      input.invoiceDueDate !== null &&
      current.invoiceDueDate === input.invoiceDueDate;
    if (keepsChoice) {
      invoice = { invoiceDueDate: input.invoiceDueDate!, invoiceOverridden: true };
    } else {
      const resolved = resolveInvoice(card.cycles, input.date, input.invoiceDueDate);
      if (!resolved.ok) return resolved;
      invoice = {
        invoiceDueDate: resolved.invoiceDueDate,
        invoiceOverridden: resolved.invoiceOverridden,
      };
    }
  } else {
    const account = refs.accounts.find((a) => a.id === input.accountId);
    if (!account) return { ok: false, error: "ACCOUNT_NOT_FOUND" };
    if (account.archivedAt !== null && account.id !== current?.accountId) {
      return { ok: false, error: "ACCOUNT_ARCHIVED" };
    }
  }

  if (input.categoryId !== null) {
    const category = refs.categories.find((c) => c.id === input.categoryId);
    if (!category) return { ok: false, error: "CATEGORY_NOT_FOUND" };
    if (category.type !== input.type) return { ok: false, error: "CATEGORY_TYPE_MISMATCH" };
    if (isArchivedEffective(category, category.parent) && category.id !== current?.categoryId) {
      return { ok: false, error: "CATEGORY_ARCHIVED" };
    }
  }

  return { ok: true, invoice };
}

/**
 * The invoice of a credit purchase: the one computed from the cycle valid on its date, or a
 * manual choice up to INVOICE_OVERRIDE_WINDOW invoices away. Choosing the computed one is no
 * override.
 */
export function resolveInvoice(
  cycles: readonly CycleVersion[],
  date: CalendarDate,
  chosen: CalendarDate | null,
):
  | { ok: true; invoiceDueDate: CalendarDate; invoiceOverridden: boolean }
  | { ok: false; error: "INVALID_INVOICE" } {
  const cycle = cycleOn(cycles, date);
  const computed = invoiceFor(cycle, date);
  if (chosen === null || chosen === computed.dueDate) {
    return { ok: true, invoiceDueDate: computed.dueDate, invoiceOverridden: false };
  }
  for (let n = -INVOICE_OVERRIDE_WINDOW; n <= INVOICE_OVERRIDE_WINDOW; n++) {
    if (shiftInvoice(cycle, computed, n).dueDate === chosen) {
      return { ok: true, invoiceDueDate: chosen, invoiceOverridden: true };
    }
  }
  return { ok: false, error: "INVALID_INVOICE" };
}

/**
 * After a card's cycle changed: the (not manually chosen) purchases whose computed invoice is
 * now different, with the new due date.
 */
export function recomputeInvoices(
  cycles: readonly CycleVersion[],
  purchases: readonly { id: string; date: CalendarDate; invoiceDueDate: CalendarDate | null }[],
): { id: string; invoiceDueDate: CalendarDate }[] {
  return purchases.flatMap((p) => {
    const due = invoiceFor(cycleOn(cycles, p.date), p.date).dueDate;
    return due === p.invoiceDueDate ? [] : [{ id: p.id, invoiceDueDate: due }];
  });
}
