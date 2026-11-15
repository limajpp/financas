/**
 * The subscriptions screen: totals, the recent change of amount and the next charge. Pure
 * functions only. Spec: docs/specs/tasks/19-subscriptions-screen.md.
 */
import { type CalendarDate, addDays } from "./dates";
import { type Month, type RuleStatus, occurrenceDate } from "./recurring";
import {
  type EntryRefs,
  type PaymentMethod,
  type TransactionError,
  validateEntry,
} from "./transactions";

/** How long a change of amount stays highlighted. */
export const RECENT_CHANGE_DAYS = 90;

/** What the active subscriptions cost per month and per year (the month × 12). */
export function subscriptionTotals(rules: readonly { status: RuleStatus; amountCents: number }[]) {
  const active = rules.filter((r) => r.status === "ACTIVE");
  const monthlyCents = active.reduce((sum, r) => sum + r.amountCents, 0);
  return { monthlyCents, yearlyCents: monthlyCents * 12, count: active.length };
}

export type RecentChange = {
  previousCents: number;
  direction: "up" | "down";
  changedOn: CalendarDate;
};

/**
 * "Era R$ X · subiu em D": the amount before the first change of the last 90 days, compared with
 * today's, and the day of the last change. Null without a change in the period, or when the
 * amount went back to what it was. `changes` come in the order they were made.
 */
export function recentChange(
  changes: readonly { changedOn: CalendarDate; previousCents: number; amountCents: number }[],
  currentCents: number,
  today: CalendarDate,
): RecentChange | null {
  const since = addDays(today, -RECENT_CHANGE_DAYS);
  const recent = changes.filter((c) => c.changedOn >= since);
  const first = recent[0];
  if (!first || first.previousCents === currentCents) return null;
  return {
    previousCents: first.previousCents,
    direction: currentCents > first.previousCents ? "up" : "down",
    changedOn: recent.at(-1)!.changedOn,
  };
}

/** The next charge of an active subscription: its day in the first month not charged yet. */
export function nextChargeDate(rule: { dayOfMonth: number; nextMonth: Month }): CalendarDate {
  return occurrenceDate(rule.dayOfMonth, rule.nextMonth);
}

/** What the subscription's edit form changes (task 19); the counterparty stays. */
export type RuleEditInput = {
  amountCents: number;
  dayOfMonth: number;
  method: PaymentMethod;
  accountId: string | null;
  cardId: string | null;
  categoryId: string | null;
  description: string | null;
};

/**
 * An edit is checked like a new expense: account, card and category of the space and active, the
 * category an expense one. What the rule already points to may stay, even archived since.
 */
export function validateRuleEdit(
  input: RuleEditInput,
  refs: EntryRefs,
  current: { accountId: string | null; cardId: string | null; categoryId: string | null },
  today: CalendarDate,
): { ok: true } | { ok: false; error: TransactionError } {
  const checked = validateEntry(
    {
      ...input,
      type: "EXPENSE",
      date: today,
      invoiceDueDate: null,
      counterparty: null,
      counterpartyAlias: null,
      counterpartyDocument: null,
      installments: null,
      subscription: false,
    },
    refs,
    { today, current },
  );
  return checked.ok ? { ok: true } : checked;
}
