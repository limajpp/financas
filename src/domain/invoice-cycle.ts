/**
 * Which credit-card invoice a purchase falls on. Pure functions over calendar dates.
 *
 * Rules (docs/specs/tasks/07-cards.md):
 * 1. A day the month doesn't have (29–31) means the month's last day.
 * 2. A purchase before the month's closing date falls on the invoice that closes that month;
 *    on the closing day or after, on the one that closes the next month.
 * 3. The invoice is due in the closing month when dueDay > closingDay, else the month after
 *    (compared on the configured numbers, not the clamped dates).
 * 4. An invoice is identified by its due date.
 */
import type { CalendarDate } from "./dates";

export type InvoiceCycle = { closingDay: number; dueDay: number };
export type Invoice = { closingDate: CalendarDate; dueDate: CalendarDate };

/** A version of a card's cycle, valid for purchases from `validFrom` on. */
export type CycleVersion = InvoiceCycle & { validFrom: CalendarDate };

/** `validFrom` of a card's first cycle: it covers any past purchase. */
export const CYCLE_EPOCH: CalendarDate = "1900-01-01";

export function isCycleDay(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= 31;
}

function assertCycle({ closingDay, dueDay }: InvoiceCycle) {
  if (!isCycleDay(closingDay) || !isCycleDay(dueDay)) {
    throw new RangeError(`Invalid cycle: closingDay ${closingDay}, dueDay ${dueDay}`);
  }
}

// Months as a running index (year * 12 + month - 1), so "next month" is just + 1.
function parse(date: CalendarDate) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { month: y * 12 + (m - 1), day: d };
}

function lastDayOf(month: number) {
  const y = Math.floor(month / 12);
  const m = month % 12; // 0-based
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** The date of `day` in `month`, clamped to the month's last day. */
function dayIn(month: number, day: number): CalendarDate {
  const y = Math.floor(month / 12);
  const m = (month % 12) + 1;
  const d = Math.min(day, lastDayOf(month));
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function invoiceClosingIn(cycle: InvoiceCycle, closingMonth: number): Invoice {
  const dueMonth = closingMonth + (cycle.dueDay > cycle.closingDay ? 0 : 1);
  return {
    closingDate: dayIn(closingMonth, cycle.closingDay),
    dueDate: dayIn(dueMonth, cycle.dueDay),
  };
}

/** The invoice a purchase on `purchaseDate` falls on. */
export function invoiceFor(cycle: InvoiceCycle, purchaseDate: CalendarDate): Invoice {
  assertCycle(cycle);
  const { month, day } = parse(purchaseDate);
  const closingThisMonth = Math.min(cycle.closingDay, lastDayOf(month));
  return invoiceClosingIn(cycle, day < closingThisMonth ? month : month + 1);
}

/**
 * The invoice `n` cycles after `invoice` (negative goes back). Installment i of a purchase falls
 * on shiftInvoice(cycle, invoiceFor(cycle, date), i - 1).
 */
export function shiftInvoice(cycle: InvoiceCycle, invoice: Invoice, n: number): Invoice {
  assertCycle(cycle);
  if (!Number.isInteger(n)) throw new RangeError(`n must be an integer, got ${n}`);
  return invoiceClosingIn(cycle, parse(invoice.closingDate).month + n);
}

/** The cycle version valid on `date`: the latest one with validFrom ≤ date. */
export function cycleOn<T extends CycleVersion>(versions: readonly T[], date: CalendarDate): T {
  let found: T | undefined;
  for (const version of versions) {
    if (version.validFrom <= date && (!found || version.validFrom > found.validFrom)) {
      found = version;
    }
  }
  if (!found) throw new RangeError(`No cycle valid on ${date}`);
  return found;
}
