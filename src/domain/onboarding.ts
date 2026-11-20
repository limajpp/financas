/**
 * The first use (onboarding): what was already going on before the app. Pure functions only.
 * Spec: docs/specs/tasks/22-onboarding.md.
 *
 * - An ongoing purchase in installments ("3 de 10") becomes the installments left, from the
 *   current one (on today's open invoice) to the last, one invoice after another.
 * - A subscription starts with its first charge after today: the past ones are in the balances.
 * - The invoices whose amount you can tell: the open one and, while it isn't due, the closed one
 *   before it.
 */
import { type CalendarDate, addMonths } from "./dates";
import {
  type CycleVersion,
  type Invoice,
  cycleOn,
  invoiceFor,
  shiftInvoice,
} from "./invoice-cycle";
import { INSTALLMENTS_MAX, type PlannedInstallment, invoiceSequence } from "./installments";
import { MAX_AMOUNT_CENTS } from "./money";
import { type Month, addMonthsToMonth, monthOf, occurrenceDate } from "./recurring";
import type { RuleEditInput } from "./subscriptions";

/** The note of an invoice's amount from before the app. */
export const OPENING_BALANCE_DESCRIPTION = "Saldo anterior da fatura";

/** The clientId prefix of the installments created by the onboarding (not typed by anyone). */
export const ONGOING_CLIENT_ID_PREFIX = "onboarding:";

/** The clientId prefix of the invoices' opening balances (not typed by anyone). */
export const OPENING_CLIENT_ID_PREFIX = "opening:";

/** One opening balance per card and invoice: saving it again replaces it. */
export const openingBalanceClientId = (cardId: string, dueDate: CalendarDate) =>
  `${OPENING_CLIENT_ID_PREFIX}${cardId}:${dueDate}`;

/** The clientId of installment `number` of an ongoing purchase: the current one carries the id. */
export const ongoingClientId = (clientId: string, number: number, current: number) =>
  number === current
    ? `${ONGOING_CLIENT_ID_PREFIX}${clientId}`
    : `${ONGOING_CLIENT_ID_PREFIX}${clientId}:${number}`;

export type OngoingInput = { current: number; total: number; amountCents: number };

/** An ongoing purchase as the onboarding takes it: on a card, with what and the category. */
export type OngoingPurchaseInput = OngoingInput & {
  cardId: string;
  counterparty: string | null;
  categoryId: string | null;
};

/** A subscription already running: what its edit form takes (task 19), plus what it is. */
export type SubscriptionRuleInput = RuleEditInput & { counterparty: string };

export type OngoingError = "INVALID_INSTALLMENTS" | "LAST_INSTALLMENT" | "INVALID_AMOUNT";

export const ONGOING_ERROR_MESSAGES: Record<OngoingError, string> = {
  INVALID_INSTALLMENTS: `Informe a parcela atual e o total, de 2 a ${INSTALLMENTS_MAX} parcelas.`,
  LAST_INSTALLMENT:
    "A parcela atual é a última: ela já está na fatura aberta, e não sobra nada para cadastrar.",
  INVALID_AMOUNT: "O valor da parcela precisa ser maior que zero.",
};

/**
 * Whether "current de total" is an ongoing purchase with something left after the current
 * installment: 2–24 installments, the current one before the last.
 */
export function validateOngoing({
  current,
  total,
  amountCents,
}: OngoingInput): { ok: true } | { ok: false; error: OngoingError } {
  if (!Number.isInteger(current) || !Number.isInteger(total) || current < 1 || total < 2) {
    return { ok: false, error: "INVALID_INSTALLMENTS" };
  }
  if (total > INSTALLMENTS_MAX || current > total) {
    return { ok: false, error: "INVALID_INSTALLMENTS" };
  }
  if (current === total) return { ok: false, error: "LAST_INSTALLMENT" };
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) {
    return { ok: false, error: "INVALID_AMOUNT" };
  }
  return { ok: true };
}

/**
 * The installments left of an ongoing purchase, from the current one to the last. The current
 * one is on today's open invoice and the next ones one per invoice (invoiceSequence). The
 * purchase is taken as made (current − 1) months ago, and installment k is dated its date plus
 * k − 1 months: each one counts in its own month.
 */
export function ongoingInstallments(
  input: OngoingInput,
  cycles: readonly CycleVersion[],
  today: CalendarDate,
): PlannedInstallment[] {
  const checked = validateOngoing(input);
  if (!checked.ok) throw new RangeError(`Invalid ongoing purchase: ${checked.error}`);
  const { current, total, amountCents } = input;
  const purchaseDate = addMonths(today, -(current - 1));
  const open = invoiceFor(cycleOn(cycles, today), today);
  const invoices = invoiceSequence(cycles, open, total - current + 1);
  return invoices.map((invoice, i) => ({
    number: current + i,
    amountCents,
    date: addMonths(purchaseDate, current - 1 + i),
    invoiceDueDate: invoice.dueDate,
  }));
}

/**
 * The month of a new subscription's first charge: the first charge date after today. Today's
 * own charge, if any, is taken as already in the balance (or on the open invoice).
 */
export function firstChargeMonth(dayOfMonth: number, today: CalendarDate): Month {
  const month = monthOf(today);
  return occurrenceDate(dayOfMonth, month) > today ? month : addMonthsToMonth(month, 1);
}

/**
 * The invoices whose amount the onboarding asks: today's open one and, while it isn't due yet
 * (due today counts as not due), the closed one before it.
 */
export function openingInvoices(
  cycles: readonly CycleVersion[],
  today: CalendarDate,
): { open: Invoice; closed: Invoice | null } {
  const cycle = cycleOn(cycles, today);
  const open = invoiceFor(cycle, today);
  const previous = shiftInvoice(cycle, open, -1);
  return { open, closed: previous.dueDate >= today ? previous : null };
}

/**
 * What stays as the opening balance of an invoice: the amount the bank shows, minus the
 * installments the onboarding created on it (they are already in that amount). Never negative.
 */
export function openingBalanceCents(informedCents: number, ongoingOnInvoiceCents: number) {
  return Math.max(0, informedCents - ongoingOnInvoiceCents);
}
