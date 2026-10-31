/**
 * Calendar dates (a day, not an instant) travel as "YYYY-MM-DD" strings. "Today" is the day in
 * São Paulo; the database stores them as DATE, read and written at UTC midnight.
 */

export const APP_TIME_ZONE = "America/Sao_Paulo";

export type CalendarDate = string;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const dayParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** True for a real day in "YYYY-MM-DD" form (rejects 2026-02-30). */
export function isCalendarDate(value: string): value is CalendarDate {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Today's date in São Paulo. */
export function todayInSaoPaulo(now: Date = new Date()): CalendarDate {
  // Built from parts: a locale's pattern (e.g. en-CA) isn't guaranteed across browsers.
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    dayParts.formatToParts(now).find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** For a Prisma DATE column: the day at UTC midnight. */
export function calendarDateToDb(date: CalendarDate): Date {
  if (!isCalendarDate(date)) throw new RangeError(`Invalid calendar date: ${date}`);
  return new Date(`${date}T00:00:00.000Z`);
}

/** From a Prisma DATE column (UTC midnight) back to "YYYY-MM-DD". */
export function dbToCalendarDate(date: Date): CalendarDate {
  return date.toISOString().slice(0, 10);
}

/** "2026-10-31" → "31/10/2026". */
export function formatCalendarDate(date: CalendarDate): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}
