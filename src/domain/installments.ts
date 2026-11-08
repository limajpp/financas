/**
 * Credit purchases in installments. Pure functions only.
 * Spec: docs/specs/tasks/12-installments.md.
 *
 * - Amount: the total divided by N, rounded down to the cent; what's left goes to the 1st.
 * - Date: installment i is the purchase date + (i − 1) months (see addMonths).
 * - Invoice: installment i falls on the (i − 1)th invoice after the purchase's, following the
 *   card's sequence of invoices (see nextInvoice).
 */
import { type CalendarDate, addMonths } from "./dates";
import { type CycleVersion, type Invoice, cycleOn, invoiceFor, nextInvoice } from "./invoice-cycle";
import { closingDateFor } from "./invoices";

export const INSTALLMENTS_MIN = 2;
export const INSTALLMENTS_MAX = 24;

export function isInstallmentCount(n: number): boolean {
  return Number.isInteger(n) && n >= INSTALLMENTS_MIN && n <= INSTALLMENTS_MAX;
}

/** `total` cents in `n` parts that add up to it exactly; the leftover cents go to the 1st. */
export function splitAmount(totalCents: number, n: number): number[] {
  if (!isInstallmentCount(n)) throw new RangeError(`Invalid installment count: ${n}`);
  if (!Number.isSafeInteger(totalCents) || totalCents < n) {
    throw new RangeError(`${totalCents} cents can't be split in ${n} installments`);
  }
  const base = Math.floor(totalCents / n);
  return [totalCents - base * (n - 1), ...Array<number>(n - 1).fill(base)];
}

/** `count` consecutive invoices of the card, starting at `first`. */
export function invoiceSequence(
  cycles: readonly CycleVersion[],
  first: Invoice,
  count: number,
): Invoice[] {
  const invoices = [first];
  while (invoices.length < count) invoices.push(nextInvoice(cycles, invoices.at(-1)!));
  return invoices;
}

export type PlannedInstallment = {
  number: number;
  amountCents: number;
  date: CalendarDate;
  invoiceDueDate: CalendarDate;
};

/** The N installments of a credit purchase of `amountCents` on `date`. */
export function planInstallments(
  purchase: { date: CalendarDate; amountCents: number },
  n: number,
  cycles: readonly CycleVersion[],
): PlannedInstallment[] {
  const amounts = splitAmount(purchase.amountCents, n);
  const first = invoiceFor(cycleOn(cycles, purchase.date), purchase.date);
  const invoices = invoiceSequence(cycles, first, n);
  return amounts.map((amountCents, i) => ({
    number: i + 1,
    amountCents,
    date: addMonths(purchase.date, i),
    invoiceDueDate: invoices[i]!.dueDate,
  }));
}

/**
 * After a card's cycle changed: the installments of one group whose invoice is now different.
 * The sequence starts at the lowest-numbered installment left: the 1st is recomputed from its
 * date like any purchase; a later one (the earlier ones were deleted) keeps its own invoice.
 */
export function replanGroupInvoices(
  rows: readonly { id: string; number: number; date: CalendarDate; invoiceDueDate: CalendarDate }[],
  cycles: readonly CycleVersion[],
): { id: string; invoiceDueDate: CalendarDate }[] {
  const sorted = [...rows].sort((a, b) => a.number - b.number);
  const anchor = sorted[0];
  if (!anchor) return [];
  const anchorInvoice =
    anchor.number === 1
      ? invoiceFor(cycleOn(cycles, anchor.date), anchor.date)
      : {
          dueDate: anchor.invoiceDueDate,
          closingDate: closingDateFor(cycles, anchor.invoiceDueDate),
        };
  const last = sorted.at(-1)!.number;
  const invoices = invoiceSequence(cycles, anchorInvoice, last - anchor.number + 1);
  return sorted.flatMap((row) => {
    const due = invoices[row.number - anchor.number]!.dueDate;
    return due === row.invoiceDueDate ? [] : [{ id: row.id, invoiceDueDate: due }];
  });
}
