import "server-only";

import { cache } from "react";

import { addDays, calendarDateToDb, dbToCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { cycleOn, invoiceFor } from "@/domain/invoice-cycle";
import {
  GENERATED_CLIENT_ID_PREFIX,
  type RuleStatus,
  dueMonths,
  monthOf,
  occurrenceDate,
  resumeMonth,
} from "@/domain/recurring";
import {
  type RuleEditInput,
  nextChargeDate,
  recentChange,
  RECENT_CHANGE_DAYS,
  validateRuleEdit,
} from "@/domain/subscriptions";
import { TRANSACTION_ERROR_MESSAGES, type TransactionError } from "@/domain/transactions";
import { db } from "@/lib/db";
import { refsFor } from "@/server/transactions";

export type RuleError = "NOT_FOUND" | "CANCELED" | "CHANGED";

export const RULE_ERROR_MESSAGES: Record<RuleError, string> = {
  NOT_FOUND: "Assinatura não encontrada.",
  CANCELED: "Essa assinatura foi cancelada.",
  CHANGED: "A assinatura mudou enquanto você editava. Tente de novo.",
};

/**
 * Charges every subscription of the space for the months whose date has come, and moves each
 * rule's cursor (src/domain/recurring.ts). Safe to run anywhere and at the same time: one charge
 * per rule and month is guaranteed by the unique index (inserts skip duplicates), and a cursor
 * only moves from the value this run read.
 */
export async function generateRecurring(spaceId: string, today = todayInSaoPaulo()) {
  const rules = await db.recurringRule.findMany({
    where: { spaceId, status: { in: ["ACTIVE", "PAUSED"] }, nextMonth: { lte: monthOf(today) } },
    include: {
      card: { select: { cycles: { select: { closingDay: true, dueDay: true, validFrom: true } } } },
    },
  });
  let charged = 0;
  for (const rule of rules) {
    const { charge, nextMonth } = dueMonths(rule, today);
    if (nextMonth === rule.nextMonth) continue;
    const cycles = rule.card?.cycles.map((c) => ({
      ...c,
      validFrom: dbToCalendarDate(c.validFrom),
    }));
    const rows = charge.map((month) => {
      const date = occurrenceDate(rule.dayOfMonth, month);
      const invoiceDueDate = cycles ? invoiceFor(cycleOn(cycles, date), date).dueDate : null;
      return {
        spaceId,
        clientId: `${GENERATED_CLIENT_ID_PREFIX}${rule.id}:${month}`,
        createdById: rule.createdById,
        type: "EXPENSE" as const,
        amountCents: rule.amountCents,
        date: calendarDateToDb(date),
        method: rule.method,
        accountId: rule.accountId,
        cardId: rule.cardId,
        invoiceDueDate: invoiceDueDate && calendarDateToDb(invoiceDueDate),
        categoryId: rule.categoryId,
        counterpartyId: rule.counterpartyId,
        description: rule.description,
        recurringRuleId: rule.id,
        recurringMonth: month,
      };
    });
    // Claim the cursor first: only the run that moves it from the value it read inserts. A run
    // that read a stale cursor (another run already charged, or the rule was undone) inserts
    // nothing, so a charge deleted meanwhile never comes back.
    charged += await db.$transaction(async (tx) => {
      const claimed = await tx.recurringRule.updateMany({
        where: { id: rule.id, nextMonth: rule.nextMonth, status: { not: "CANCELED" } },
        data: { nextMonth },
      });
      if (claimed.count === 0 || rows.length === 0) return 0;
      const created = await tx.transaction.createMany({ data: rows, skipDuplicates: true });
      return created.count;
    });
  }
  return { charged };
}

/**
 * generateRecurring for the screens: a failure is logged and the screen still shows (one render
 * without the newest charge is better than an error page). The next screen tries again.
 */
export async function generateRecurringSafely(spaceId: string) {
  try {
    await generateRecurring(spaceId);
  } catch (error) {
    console.error("generateRecurring failed", error);
  }
}

/**
 * generateRecurringSafely once per request (React's cache): the dashboard's blocks each need the
 * charges up to today, and one run is enough for all of them.
 */
export const generateRecurringOnce = cache(generateRecurringSafely);

async function findRule(spaceId: string, id: string) {
  return db.recurringRule.findFirst({
    where: { id, spaceId },
    select: { id: true, amountCents: true, dayOfMonth: true, status: true, nextMonth: true },
  });
}

/**
 * Changes the amount of the next charges and records the change with today's date (the charges
 * already made stay as they were).
 */
export async function updateRecurringRule(
  spaceId: string,
  id: string,
  { amountCents }: { amountCents: number },
): Promise<{ ok: true } | { ok: false; error: RuleError }> {
  // Written only if the amount is still the one read, so the history's "previous" is right; an
  // edit in between (the subscriptions screen, task 19) means reading again.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const rule = await findRule(spaceId, id);
    if (!rule) return { ok: false, error: "NOT_FOUND" };
    if (rule.status === "CANCELED") return { ok: false, error: "CANCELED" };
    if (rule.amountCents === amountCents) return { ok: true };
    const written = await db.$transaction(async (tx) => {
      const updated = await tx.recurringRule.updateMany({
        where: { id, spaceId, status: { not: "CANCELED" }, amountCents: rule.amountCents },
        data: { amountCents },
      });
      if (updated.count > 0) {
        await tx.recurringRuleChange.create({
          data: {
            ruleId: id,
            previousCents: rule.amountCents,
            amountCents,
            changedOn: calendarDateToDb(todayInSaoPaulo()),
          },
        });
      }
      return updated.count;
    });
    if (written > 0) return { ok: true };
  }
  return { ok: false, error: "CHANGED" };
}

/**
 * Pauses, resumes or cancels a subscription. Canceling is final. Resuming moves the cursor past
 * the paused months, so they aren't charged late.
 */
export async function setRecurringRuleStatus(
  spaceId: string,
  id: string,
  status: RuleStatus,
): Promise<{ ok: true } | { ok: false; error: RuleError }> {
  const rule = await findRule(spaceId, id);
  if (!rule) return { ok: false, error: "NOT_FOUND" };
  if (rule.status === "CANCELED") return { ok: false, error: "CANCELED" };
  if (rule.status === status) return { ok: true };

  // Conditional writes: a cancel racing a pause or a resume always wins (canceling is final).
  const notCanceled = { id, spaceId, status: { not: "CANCELED" as const } };
  let written: { count: number };
  if (status === "CANCELED") {
    written = await db.recurringRule.updateMany({
      where: notCanceled,
      data: { status, canceledAt: new Date() },
    });
  } else if (status === "ACTIVE") {
    const resume = resumeMonth(rule.dayOfMonth, todayInSaoPaulo());
    written = await db.recurringRule.updateMany({
      where: { ...notCanceled, status: "PAUSED" },
      data: {
        status,
        pausedAt: null,
        nextMonth: resume > rule.nextMonth ? resume : rule.nextMonth,
      },
    });
  } else {
    written = await db.recurringRule.updateMany({
      where: { ...notCanceled, status: "ACTIVE" },
      data: { status, pausedAt: new Date() },
    });
  }
  if (written.count === 0) {
    const now = await findRule(spaceId, id);
    if (!now) return { ok: false, error: "NOT_FOUND" };
    if (now.status === "CANCELED") return { ok: false, error: "CANCELED" };
  }
  return { ok: true };
}

/** How long after creating a subscription its "Desfazer" still undoes the whole of it. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

/**
 * The "Desfazer" of a new subscription. Undoing its 1st charge (the one you registered) within
 * UNDO_WINDOW_MS undoes the whole subscription: the rule and every charge it has, since any other
 * one was generated by the screens right after that save (a backdated subscription charges the
 * months since). Otherwise only the given charge goes: deleting an old charge must never wipe a
 * subscription's history.
 */
export async function undoSubscription(
  spaceId: string,
  transactionId: string,
): Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" }> {
  const charge = await db.transaction.findFirst({
    where: { id: transactionId, spaceId, recurringRuleId: { not: null } },
    select: {
      recurringRuleId: true,
      recurringMonth: true,
      recurringRule: { select: { firstMonth: true, createdAt: true } },
    },
  });
  if (!charge) return { ok: false, error: "NOT_FOUND" };
  const ruleId = charge.recurringRuleId!;
  const rule = charge.recurringRule!;
  const isNew = Date.now() - rule.createdAt.getTime() < UNDO_WINDOW_MS;
  if (charge.recurringMonth !== rule.firstMonth || !isNew) {
    await db.transaction.deleteMany({ where: { id: transactionId, spaceId } });
    return { ok: true };
  }
  await db.$transaction(async (tx) => {
    // Cancel first: a generation running now can't claim the cursor of a canceled rule.
    await tx.recurringRule.updateMany({
      where: { id: ruleId, spaceId },
      data: { status: "CANCELED", canceledAt: new Date() },
    });
    await tx.transaction.deleteMany({ where: { recurringRuleId: ruleId, spaceId } });
    await tx.recurringRule.deleteMany({ where: { id: ruleId, spaceId } });
  });
  return { ok: true };
}

/**
 * Edits a subscription (task 19): amount, day, category, payment and note, for the next charges
 * (the ones already made stay). A new amount goes to the history. The cursor stays: a month already
 * charged is never charged again, and a month not charged yet is charged on the new day.
 */
export async function editRecurringRule(
  spaceId: string,
  id: string,
  input: RuleEditInput,
): Promise<{ ok: true } | { ok: false; error: RuleError | TransactionError }> {
  // The charges already due go out on the old terms first: the edit is for the next ones.
  await generateRecurringSafely(spaceId);
  // The amount is read, then written only if unchanged (the history's "previous" must be right);
  // an amount changed in between (another tab's "Atualizar a assinatura?") means reading again.
  for (let attempt = 1; ; attempt++) {
    const result = await editOnce(spaceId, id, input);
    if (result !== "RETRY") return result;
    if (attempt >= 3) return { ok: false, error: "CHANGED" };
  }
}

async function editOnce(
  spaceId: string,
  id: string,
  input: RuleEditInput,
): Promise<{ ok: true } | { ok: false; error: RuleError | TransactionError } | "RETRY"> {
  const rule = await db.recurringRule.findFirst({
    where: { id, spaceId },
    select: { amountCents: true, status: true, accountId: true, cardId: true, categoryId: true },
  });
  if (!rule) return { ok: false, error: "NOT_FOUND" };
  if (rule.status === "CANCELED") return { ok: false, error: "CANCELED" };
  const today = todayInSaoPaulo();
  const refs = await refsFor(spaceId, {
    type: "EXPENSE",
    amountCents: input.amountCents,
    date: today,
    method: input.method,
    accountId: input.accountId,
    cardId: input.cardId,
    invoiceDueDate: null,
    categoryId: input.categoryId,
    counterparty: null,
    counterpartyAlias: null,
    counterpartyDocument: null,
    description: input.description,
    installments: null,
    subscription: false,
  });
  const checked = validateRuleEdit(input, refs, rule, today);
  if (!checked.ok) return checked;

  const updated = await db.$transaction(async (tx) => {
    // Conditional: a cancel in the meantime wins (canceling is final), and the amount is the one
    // read above.
    const written = await tx.recurringRule.updateMany({
      where: { id, spaceId, status: { not: "CANCELED" }, amountCents: rule.amountCents },
      data: {
        amountCents: input.amountCents,
        dayOfMonth: input.dayOfMonth,
        method: input.method,
        accountId: input.accountId,
        cardId: input.cardId,
        categoryId: input.categoryId,
        description: input.description,
      },
    });
    if (written.count > 0 && input.amountCents !== rule.amountCents) {
      await tx.recurringRuleChange.create({
        data: {
          ruleId: id,
          previousCents: rule.amountCents,
          amountCents: input.amountCents,
          changedOn: calendarDateToDb(today),
        },
      });
    }
    return written.count;
  });
  if (updated === 0) {
    const now = await db.recurringRule.findFirst({
      where: { id, spaceId },
      select: { status: true },
    });
    if (!now) return { ok: false, error: "NOT_FOUND" };
    return now.status === "CANCELED" ? { ok: false, error: "CANCELED" } : "RETRY";
  }
  return { ok: true };
}

/** The message of an edit error: the subscription's own, or the one an expense would get. */
export function ruleEditMessage(error: RuleError | TransactionError) {
  return error === "NOT_FOUND" || error === "CANCELED" || error === "CHANGED"
    ? RULE_ERROR_MESSAGES[error]
    : TRANSACTION_ERROR_MESSAGES[error];
}

/**
 * The subscriptions screen (task 19): every rule of the space, most expensive first, with where it
 * charges, its category and counterparty, the next charge (active ones) and a change of amount in
 * the last 90 days.
 */
export async function listSubscriptions(spaceId: string) {
  // The charges up to today first, so each next date is the real next one (task 13).
  await generateRecurringSafely(spaceId);
  const today = todayInSaoPaulo();
  const rules = await db.recurringRule.findMany({
    where: { spaceId },
    orderBy: [{ amountCents: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      amountCents: true,
      dayOfMonth: true,
      method: true,
      status: true,
      description: true,
      firstMonth: true,
      nextMonth: true,
      pausedAt: true,
      canceledAt: true,
      account: { select: { id: true, name: true, archivedAt: true } },
      card: { select: { id: true, name: true, archivedAt: true } },
      category: { select: { id: true, name: true, icon: true, color: true } },
      counterparty: { select: { id: true, name: true } },
      changes: {
        where: { changedOn: { gte: calendarDateToDb(addDays(today, -RECENT_CHANGE_DAYS)) } },
        orderBy: { createdAt: "asc" },
        select: { changedOn: true, previousCents: true, amountCents: true },
      },
    },
  });
  return rules.map(({ changes, pausedAt, canceledAt, account, card, ...rule }) => ({
    ...rule,
    account: account && {
      id: account.id,
      name: account.name,
      archived: account.archivedAt !== null,
    },
    card: card && { id: card.id, name: card.name, archived: card.archivedAt !== null },
    pausedOn: pausedAt && todayInSaoPaulo(pausedAt),
    canceledOn: canceledAt && todayInSaoPaulo(canceledAt),
    nextCharge: rule.status === "ACTIVE" ? nextChargeDate(rule) : null,
    change: recentChange(
      changes.map((c) => ({ ...c, changedOn: dbToCalendarDate(c.changedOn) })),
      rule.amountCents,
      today,
    ),
  }));
}

export type SubscriptionRow = Awaited<ReturnType<typeof listSubscriptions>>[number];
