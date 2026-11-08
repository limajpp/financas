import "server-only";

import { calendarDateToDb, dbToCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { cycleOn, invoiceFor } from "@/domain/invoice-cycle";
import {
  GENERATED_CLIENT_ID_PREFIX,
  type RuleStatus,
  dueMonths,
  monthOf,
  occurrenceDate,
  resumeMonth,
} from "@/domain/recurring";
import { db } from "@/lib/db";

export type RuleError = "NOT_FOUND" | "CANCELED";

export const RULE_ERROR_MESSAGES: Record<RuleError, string> = {
  NOT_FOUND: "Assinatura não encontrada.",
  CANCELED: "Essa assinatura foi cancelada.",
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
  const rule = await findRule(spaceId, id);
  if (!rule) return { ok: false, error: "NOT_FOUND" };
  if (rule.status === "CANCELED") return { ok: false, error: "CANCELED" };
  if (rule.amountCents === amountCents) return { ok: true };
  await db.$transaction([
    db.recurringRule.update({ where: { id }, data: { amountCents } }),
    db.recurringRuleChange.create({
      data: {
        ruleId: id,
        previousCents: rule.amountCents,
        amountCents,
        changedOn: calendarDateToDb(todayInSaoPaulo()),
      },
    }),
  ]);
  return { ok: true };
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
      data: { status, nextMonth: resume > rule.nextMonth ? resume : rule.nextMonth },
    });
  } else {
    written = await db.recurringRule.updateMany({
      where: { ...notCanceled, status: "ACTIVE" },
      data: { status },
    });
  }
  if (written.count === 0) {
    const now = await findRule(spaceId, id);
    if (!now) return { ok: false, error: "NOT_FOUND" };
    if (now.status === "CANCELED") return { ok: false, error: "CANCELED" };
  }
  return { ok: true };
}

/**
 * The "Desfazer" of a new subscription. Undoing its 1st charge (the one you registered) undoes
 * the whole subscription: the rule and every charge it has, since any other one was generated by
 * the screens right after that save (a backdated subscription charges the months since). Undoing
 * a later charge deletes only it.
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
      recurringRule: { select: { firstMonth: true } },
    },
  });
  if (!charge) return { ok: false, error: "NOT_FOUND" };
  const ruleId = charge.recurringRuleId!;
  if (charge.recurringMonth !== charge.recurringRule!.firstMonth) {
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
