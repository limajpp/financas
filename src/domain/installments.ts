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
import {
  type CycleVersion,
  type Invoice,
  cycleOn,
  invoiceFor,
  nextInvoice,
  shiftInvoice,
} from "./invoice-cycle";
import { closingDateFor } from "./invoices";
import { INVOICE_OVERRIDE_WINDOW } from "./transactions";

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

type GroupRow = { id: string; number: number; date: CalendarDate; invoiceDueDate: CalendarDate };

/**
 * The invoice each installment of a group should be on, by number. The sequence starts at the
 * lowest-numbered installment left: the 1st is computed from its date like any purchase; a later
 * one (the earlier ones were deleted) keeps its own invoice.
 */
function plannedGroupInvoices(
  sorted: readonly GroupRow[],
  cycles: readonly CycleVersion[],
): Map<number, Invoice> {
  const anchor = sorted[0];
  if (!anchor) return new Map();
  const anchorInvoice =
    anchor.number === 1
      ? invoiceFor(cycleOn(cycles, anchor.date), anchor.date)
      : {
          dueDate: anchor.invoiceDueDate,
          closingDate: closingDateFor(cycles, anchor.invoiceDueDate),
        };
  const last = sorted.at(-1)!.number;
  const invoices = invoiceSequence(cycles, anchorInvoice, last - anchor.number + 1);
  return new Map(invoices.map((invoice, i) => [anchor.number + i, invoice]));
}

const byNumber = (rows: readonly GroupRow[]) => [...rows].sort((a, b) => a.number - b.number);

/** After a card's cycle changed: the installments of one group whose invoice is now different. */
export function replanGroupInvoices(
  rows: readonly GroupRow[],
  cycles: readonly CycleVersion[],
): { id: string; invoiceDueDate: CalendarDate }[] {
  const sorted = byNumber(rows);
  const planned = plannedGroupInvoices(sorted, cycles);
  return sorted.flatMap((row) => {
    const due = planned.get(row.number)!.dueDate;
    return due === row.invoiceDueDate ? [] : [{ id: row.id, invoiceDueDate: due }];
  });
}

/**
 * The invoices an installment may be moved to: its computed invoice and up to 3 before and after
 * (the window of task 8). The edit dialog offers these; the server checks against them.
 */
export function installmentInvoiceWindow(
  cycles: readonly CycleVersion[],
  computed: Invoice,
): Invoice[] {
  const cycle = cycleOn(cycles, computed.closingDate);
  const window: Invoice[] = [];
  for (let n = -INVOICE_OVERRIDE_WINDOW; n <= INVOICE_OVERRIDE_WINDOW; n++) {
    window.push(n === 0 ? computed : shiftInvoice(cycle, computed, n));
  }
  return window;
}

/**
 * Moves installment `moved.number` to another invoice (task 18): it and the next ones go one per
 * invoice from there, and the earlier ones stay. The chosen invoice must be at most 3 invoices
 * away from the one computed for that installment (the window of task 8), and after the invoice
 * of the installment before it: two installments never share an invoice. Each moved installment is
 * a manual choice unless it lands on its computed invoice.
 */
export function shiftGroupInvoices(
  rows: readonly GroupRow[],
  cycles: readonly CycleVersion[],
  moved: { number: number; invoiceDueDate: CalendarDate },
):
  | {
      ok: true;
      updates: { id: string; invoiceDueDate: CalendarDate; invoiceOverridden: boolean }[];
    }
  | { ok: false; error: "INVALID_INVOICE" | "INSTALLMENT_ORDER" } {
  const sorted = byNumber(rows);
  const planned = plannedGroupInvoices(sorted, cycles);
  const computed = planned.get(moved.number);
  if (!computed) return { ok: false, error: "INVALID_INVOICE" };

  const chosen = installmentInvoiceWindow(cycles, computed).find(
    (invoice) => invoice.dueDate === moved.invoiceDueDate,
  );
  if (!chosen) return { ok: false, error: "INVALID_INVOICE" };
  const before = sorted.filter((row) => row.number < moved.number).at(-1);
  if (before && chosen.dueDate <= before.invoiceDueDate) {
    return { ok: false, error: "INSTALLMENT_ORDER" };
  }

  const following = sorted.filter((row) => row.number >= moved.number);
  const last = following.at(-1)!.number;
  const invoices = invoiceSequence(cycles, chosen, last - moved.number + 1);
  return {
    ok: true,
    updates: following.map((row) => {
      const due = invoices[row.number - moved.number]!.dueDate;
      return {
        id: row.id,
        invoiceDueDate: due,
        invoiceOverridden: due !== planned.get(row.number)!.dueDate,
      };
    }),
  };
}
