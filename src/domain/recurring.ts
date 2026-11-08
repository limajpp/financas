/**
 * Subscriptions (recurring monthly expenses). Pure functions only.
 * Spec: docs/specs/tasks/13-subscriptions.md.
 *
 * A rule has a day of the month and a cursor, `nextMonth`: the first month the generation hasn't
 * looked at yet. Each run looks at the months from the cursor up to the current one whose charge
 * date has come; an active rule charges them, a paused one skips them; either way the cursor moves
 * past them, so a deleted charge or a paused month never comes back.
 */
import type { CalendarDate } from "./dates";

/** A calendar month, "YYYY-MM". */
export type Month = string;

export const RULE_STATUSES = ["ACTIVE", "PAUSED", "CANCELED"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/** The clientId prefix of the charges the generation creates (not typed by anyone). */
export const GENERATED_CLIENT_ID_PREFIX = "rule:";

export function isDayOfMonth(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= 31;
}

export function monthOf(date: CalendarDate): Month {
  return date.slice(0, 7);
}

export function addMonthsToMonth(month: Month, n: number): Month {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String(index - year * 12 + 1).padStart(2, "0")}`;
}

/** The charge date of `month`: the rule's day, or the month's last day when it lacks it. */
export function occurrenceDate(dayOfMonth: number, month: Month): CalendarDate {
  if (!isDayOfMonth(dayOfMonth)) throw new RangeError(`Invalid day of month: ${dayOfMonth}`);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(dayOfMonth, last)).padStart(2, "0")}`;
}

export type RuleCursor = { status: RuleStatus; dayOfMonth: number; nextMonth: Month };

/**
 * What a generation run does with a rule today: the months to charge (none unless active) and the
 * new cursor. Only months whose charge date has come: never a future charge.
 */
export function dueMonths(
  rule: RuleCursor,
  today: CalendarDate,
): { charge: Month[]; nextMonth: Month } {
  if (rule.status === "CANCELED") return { charge: [], nextMonth: rule.nextMonth };
  const due: Month[] = [];
  let month = rule.nextMonth;
  while (occurrenceDate(rule.dayOfMonth, month) <= today) {
    due.push(month);
    month = addMonthsToMonth(month, 1);
  }
  return { charge: rule.status === "ACTIVE" ? due : [], nextMonth: month };
}

/**
 * The cursor after resuming a pause today: the first month whose charge hasn't passed, so the
 * paused months aren't charged late. Today's charge date counts as not passed.
 */
export function resumeMonth(dayOfMonth: number, today: CalendarDate): Month {
  const month = monthOf(today);
  return occurrenceDate(dayOfMonth, month) >= today ? month : addMonthsToMonth(month, 1);
}
