import "server-only";

import webpush from "web-push";

import { saoPauloDayBounds, todayInSaoPaulo } from "@/domain/dates";
import { GENERATED_CLIENT_ID_PREFIX } from "@/domain/recurring";
import {
  afterPushFailure,
  type PushPayload,
  reminderPayload,
  TEST_BODY,
  TEST_TAG,
  TEST_TITLE,
} from "@/domain/reminder";
import { db } from "@/lib/db";
import type { PushSubscriptionInput } from "@/lib/validation/push";
import { vapidDetailsFrom } from "@/lib/vapid";

/** The push service keeps a reminder this long for a device that's off: not until tomorrow noon. */
const REMINDER_TTL_SECONDS = 12 * 60 * 60;
const TEST_TTL_SECONDS = 60;
/** Pushes in flight at once. */
const CONCURRENCY = 10;

/** A push service that doesn't answer mustn't hold the whole cron. */
const SEND_TIMEOUT_MS = 10_000;

const vapidDetails = () => vapidDetailsFrom(process.env);

/** The VAPID public key the browser subscribes with, or null when push isn't configured. */
export function vapidPublicKey() {
  return vapidDetails()?.publicKey ?? null;
}

/** Saves this device's subscription for the user (taking it over if another user had it). */
export async function savePushSubscription(
  userId: string,
  input: PushSubscriptionInput,
  userAgent: string | null,
) {
  const data = {
    userId,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    userAgent: userAgent?.slice(0, 300) ?? null,
  };
  await db.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { endpoint: input.endpoint, ...data },
    update: data,
  });
}

/** Removes the user's subscription for this device (someone else's stays). */
export async function deletePushSubscription(userId: string, endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

export async function hasPushSubscription(userId: string, endpoint: string) {
  return (await db.pushSubscription.count({ where: { userId, endpoint } })) > 0;
}

type Row = { id: string; endpoint: string; p256dh: string; auth: string };
type Delivery = "SENT" | "REMOVED" | "FAILED";

async function deliver(row: Row, payload: PushPayload, ttl: number): Promise<Delivery> {
  const vapid = vapidDetails();
  if (!vapid) return "FAILED";
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(payload),
      { TTL: ttl, vapidDetails: vapid, urgency: "normal", timeout: SEND_TIMEOUT_MS },
    );
  } catch (error) {
    const status = error instanceof webpush.WebPushError ? error.statusCode : undefined;
    if (afterPushFailure(status) === "REMOVE") {
      // Best effort: a failing delete mustn't stop the other devices' sends.
      await db.pushSubscription.deleteMany({ where: { id: row.id } }).catch(() => {});
      return "REMOVED";
    }
    console.error("push failed", { subscription: row.id, status });
    return "FAILED";
  }
  // updateMany: the row may be gone meanwhile (reminder turned off during the cron).
  await db.pushSubscription
    .updateMany({ where: { id: row.id }, data: { lastSentAt: new Date() } })
    .catch(() => {});
  return "SENT";
}

/** Runs `work` over `items`, at most `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
  const results: R[] = [];
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  });
  await Promise.all(lanes);
  return results;
}

export type TestPushResult =
  { ok: true } | { ok: false; error: "UNAVAILABLE" | "NOT_FOUND" | "EXPIRED" | "FAILED" };

/** The settings' test notification, to this device only. */
export async function sendTestPush(userId: string, endpoint: string): Promise<TestPushResult> {
  if (!vapidDetails()) return { ok: false, error: "UNAVAILABLE" };
  const row = await db.pushSubscription.findFirst({ where: { userId, endpoint } });
  if (!row) return { ok: false, error: "NOT_FOUND" };
  const payload = { title: TEST_TITLE, body: TEST_BODY, url: "/configuracoes", tag: TEST_TAG };
  const result = await deliver(row, payload, TEST_TTL_SECONDS);
  if (result === "SENT") return { ok: true };
  return { ok: false, error: result === "REMOVED" ? "EXPIRED" : "FAILED" };
}

/**
 * The daily reminder to every subscribed device. The text counts what each user registered today
 * (by registration time, São Paulo day). One device's failure doesn't stop the others.
 */
export async function sendDailyReminders(now = new Date()) {
  const totals = { sent: 0, removed: 0, failed: 0 };
  if (!vapidDetails()) return { ...totals, skipped: true };
  const rows = await db.pushSubscription.findMany({
    select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
  });
  if (rows.length === 0) return { ...totals, skipped: false };

  const { start, end } = saoPauloDayBounds(todayInSaoPaulo(now));
  const counts = await db.transaction.groupBy({
    by: ["createdById"],
    where: {
      createdById: { in: [...new Set(rows.map((r) => r.userId))] },
      createdAt: { gte: start, lt: end },
      // What the user registered: not the charges the cron itself generates (task 13), and a
      // purchase in installments once, not once per installment.
      NOT: { clientId: { startsWith: GENERATED_CLIENT_ID_PREFIX } },
      OR: [{ installmentNumber: null }, { installmentNumber: 1 }],
      // Nor a balance adjustment (task 21): it corrects the balance, it isn't an entry.
      adjustment: false,
    },
    _count: { _all: true },
  });
  const countOf = new Map(counts.map((c) => [c.createdById, c._count._all]));

  const results = await pool(rows, CONCURRENCY, (row) =>
    deliver(row, reminderPayload(countOf.get(row.userId) ?? 0), REMINDER_TTL_SECONDS),
  );
  for (const result of results) {
    if (result === "SENT") totals.sent++;
    else if (result === "REMOVED") totals.removed++;
    else totals.failed++;
  }
  return { ...totals, skipped: false };
}
