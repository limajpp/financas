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
    const [created] = await db.$transaction([
      db.transaction.createMany({ data: rows, skipDuplicates: true }),
      db.recurringRule.updateMany({
        where: { id: rule.id, nextMonth: rule.nextMonth },
        data: { nextMonth },
      }),
    ]);
    charged += created.count;
  }
  return { charged };
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

  if (status === "CANCELED") {
    await db.recurringRule.update({ where: { id }, data: { status, canceledAt: new Date() } });
  } else if (status === "ACTIVE") {
    const resume = resumeMonth(rule.dayOfMonth, todayInSaoPaulo());
    await db.recurringRule.update({
      where: { id },
      data: { status, nextMonth: resume > rule.nextMonth ? resume : rule.nextMonth },
    });
  } else {
    await db.recurringRule.update({ where: { id }, data: { status } });
  }
  return { ok: true };
}

/**
 * The "Desfazer" of a new subscription: deletes the charge and, when it was the rule's only one,
 * the rule too.
 */
export async function undoSubscription(
  spaceId: string,
  transactionId: string,
): Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" }> {
  const charge = await db.transaction.findFirst({
    where: { id: transactionId, spaceId, recurringRuleId: { not: null } },
    select: { recurringRuleId: true },
  });
  if (!charge) return { ok: false, error: "NOT_FOUND" };
  const ruleId = charge.recurringRuleId!;
  await db.$transaction(async (tx) => {
    await tx.transaction.delete({ where: { id: transactionId } });
    const others = await tx.transaction.count({ where: { recurringRuleId: ruleId } });
    if (others === 0) await tx.recurringRule.delete({ where: { id: ruleId } });
  });
  return { ok: true };
}
