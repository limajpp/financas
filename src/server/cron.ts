import "server-only";

import { todayInSaoPaulo } from "@/domain/dates";
import { db } from "@/lib/db";
import { sendDailyReminders } from "@/server/push";
import { generateRecurring } from "@/server/recurring";

/**
 * The daily cron (21h in São Paulo): first the subscription charges due today in every space
 * (task 13; one space's failure doesn't stop the others), then the reminders.
 */
export async function runDailyCron(now = new Date()) {
  const today = todayInSaoPaulo(now);
  const spaces = await db.space.findMany({ select: { id: true } });
  let generated = 0;
  let failed = 0;
  for (const space of spaces) {
    try {
      await generateRecurring(space.id, today);
      generated++;
    } catch (error) {
      failed++;
      console.error("cron: generateRecurring failed", { space: space.id, error });
    }
  }
  const reminders = await sendDailyReminders(now);
  return { spaces: { generated, failed }, reminders };
}
