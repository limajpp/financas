/**
 * A card's invoices: what each one adds up to, what was paid and what's left. Pure functions only.
 * Spec: docs/specs/tasks/11-transfers-card-payments.md.
 */
import type { CalendarDate } from "./dates";
import {
  type CycleVersion,
  cycleOn,
  invoiceFor,
  invoiceForDueDate,
  shiftInvoice,
} from "./invoice-cycle";

export type InvoiceSummary = {
  dueDate: CalendarDate;
  closingDate: CalendarDate;
  totalCents: number;
  paidCents: number;
  /** total − paid; negative when overpaid (credit). */
  remainingCents: number;
  /** Still taking purchases: today is before its closing date. */
  open: boolean;
};

type Amount = { invoiceDueDate: CalendarDate; amountCents: number };

/** How many invoices before the open one a payment may still go to, without purchases on it. */
export const PAYABLE_PAST_INVOICES = 12;

/**
 * The closing date of the invoice due on `dueDate`: from the cycle version that produces that due
 * date (the latest one valid by its closing), else the version valid on the due date.
 */
function closingDateFor(cycles: readonly CycleVersion[], dueDate: CalendarDate): CalendarDate {
  let best: { validFrom: CalendarDate; closingDate: CalendarDate } | null = null;
  for (const version of cycles) {
    const invoice = invoiceForDueDate(version, dueDate);
    if (invoice.dueDate !== dueDate || version.validFrom > invoice.closingDate) continue;
    if (!best || version.validFrom > best.validFrom) {
      best = { validFrom: version.validFrom, closingDate: invoice.closingDate };
    }
  }
  return best?.closingDate ?? invoiceForDueDate(cycleOn(cycles, dueDate), dueDate).closingDate;
}

/**
 * One summary per invoice that has purchases or payments, plus today's open invoice; oldest
 * first. `purchases` are the card's credit purchases, `payments` its invoice payments.
 */
export function invoiceSummaries(
  purchases: readonly Amount[],
  payments: readonly Amount[],
  cycles: readonly CycleVersion[],
  today: CalendarDate,
): InvoiceSummary[] {
  const totals = new Map<CalendarDate, { total: number; paid: number }>();
  const add = (dueDate: CalendarDate, field: "total" | "paid", cents: number) => {
    const entry = totals.get(dueDate) ?? { total: 0, paid: 0 };
    entry[field] += cents;
    totals.set(dueDate, entry);
  };
  for (const p of purchases) add(p.invoiceDueDate, "total", p.amountCents);
  for (const p of payments) add(p.invoiceDueDate, "paid", p.amountCents);
  add(invoiceFor(cycleOn(cycles, today), today).dueDate, "total", 0);

  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dueDate, { total, paid }]) => {
      const closingDate = closingDateFor(cycles, dueDate);
      return {
        dueDate,
        closingDate,
        totalCents: total,
        paidCents: paid,
        remainingCents: total - paid,
        open: today < closingDate,
      };
    });
}

/**
 * Whether a payment may go to the invoice due on `dueDate`: one of the card's purchases falls on
 * it, or, by the current cycle, it's the open invoice, the next one or one of the 12 before.
 */
export function isPayableInvoice(
  dueDate: CalendarDate,
  purchaseDueDates: readonly CalendarDate[],
  cycles: readonly CycleVersion[],
  today: CalendarDate,
): boolean {
  if (purchaseDueDates.includes(dueDate)) return true;
  const cycle = cycleOn(cycles, today);
  const open = invoiceFor(cycle, today);
  for (let n = -PAYABLE_PAST_INVOICES; n <= 1; n++) {
    if (shiftInvoice(cycle, open, n).dueDate === dueDate) return true;
  }
  return false;
}

/** The invoice the payment dialog starts on: the oldest closed one with something left to pay. */
export function defaultInvoiceToPay(summaries: readonly InvoiceSummary[]): CalendarDate | null {
  const unpaid = summaries.find((s) => !s.open && s.remainingCents > 0);
  return (unpaid ?? summaries.find((s) => s.open) ?? summaries.at(-1))?.dueDate ?? null;
}
