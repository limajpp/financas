import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  calendarDateToDb,
  dbToCalendarDate,
  formatCalendarDate,
  isCalendarDate,
  todayInSaoPaulo,
} from "./dates";

describe("todayInSaoPaulo", () => {
  it("is still the same day at 23:30 in Brasília, already the next day in UTC", () => {
    expect(todayInSaoPaulo(new Date("2026-11-01T02:30:00Z"))).toBe("2026-10-31");
  });

  it("turns the day at midnight in Brasília", () => {
    expect(todayInSaoPaulo(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11-01");
  });

  it("handles the new year", () => {
    expect(todayInSaoPaulo(new Date("2027-01-01T02:59:59Z"))).toBe("2026-12-31");
  });
});

describe("isCalendarDate", () => {
  it("accepts real days and refuses the rest", () => {
    expect(isCalendarDate("2026-10-31")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("31/10/2026")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("database round-trip", () => {
  it("stores the day at UTC midnight and reads back the same day", () => {
    const stored = calendarDateToDb("2026-10-31");
    expect(stored.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(dbToCalendarDate(stored)).toBe("2026-10-31");
    for (const day of ["2026-01-01", "2026-12-31", "2028-02-29"]) {
      expect(dbToCalendarDate(calendarDateToDb(day))).toBe(day);
    }
  });

  it("refuses an invalid day", () => {
    expect(() => calendarDateToDb("2026-02-30")).toThrow(RangeError);
  });
});

describe("formatCalendarDate", () => {
  it("formats as dd/mm/yyyy", () => {
    expect(formatCalendarDate("2026-10-31")).toBe("31/10/2026");
  });
});

describe("addDays", () => {
  it("moves across months, years and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-31", -90)).toBe("2026-08-02");
    expect(addDays("2026-10-31", 0)).toBe("2026-10-31");
  });
});

describe("addMonths", () => {
  it("CA2: keeps the day; a day the month lacks becomes its last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2026-01-31", 3)).toBe("2026-04-30");
    expect(addMonths("2026-10-15", 0)).toBe("2026-10-15");
  });

  it("crosses years both ways", () => {
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2028-02-29", 12)).toBe("2029-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", -13)).toBe("2024-12-15");
  });
});
