import { describe, expect, it } from "vitest";

import { addMonthsToMonth, dueMonths, occurrenceDate, resumeMonth } from "./recurring";

describe("occurrenceDate", () => {
  it("CA2: day 31 in a 30-day month and in February", () => {
    expect(occurrenceDate(31, "2026-04")).toBe("2026-04-30");
    expect(occurrenceDate(31, "2026-02")).toBe("2026-02-28");
    expect(occurrenceDate(31, "2028-02")).toBe("2028-02-29");
    expect(occurrenceDate(30, "2026-02")).toBe("2026-02-28");
    expect(occurrenceDate(31, "2026-03")).toBe("2026-03-31");
    expect(occurrenceDate(8, "2026-11")).toBe("2026-11-08");
  });

  it("refuses a day outside 1–31", () => {
    expect(() => occurrenceDate(0, "2026-04")).toThrow(RangeError);
    expect(() => occurrenceDate(32, "2026-04")).toThrow(RangeError);
  });
});

describe("addMonthsToMonth", () => {
  it("crosses years", () => {
    expect(addMonthsToMonth("2026-12", 1)).toBe("2027-01");
    expect(addMonthsToMonth("2026-01", -1)).toBe("2025-12");
    expect(addMonthsToMonth("2026-05", 14)).toBe("2027-07");
  });
});

describe("dueMonths", () => {
  const active = { status: "ACTIVE" as const, dayOfMonth: 15, nextMonth: "2026-11" };

  it("charges the current month only once its date has come", () => {
    expect(dueMonths(active, "2026-11-14")).toEqual({ charge: [], nextMonth: "2026-11" });
    expect(dueMonths(active, "2026-11-15")).toEqual({ charge: ["2026-11"], nextMonth: "2026-12" });
  });

  it("CA1: a second run with the moved cursor charges nothing", () => {
    const first = dueMonths(active, "2026-11-20");
    expect(dueMonths({ ...active, nextMonth: first.nextMonth }, "2026-11-20")).toEqual({
      charge: [],
      nextMonth: "2026-12",
    });
  });

  it("catches up the months the app wasn't opened, never a future one", () => {
    expect(dueMonths({ ...active, nextMonth: "2026-09" }, "2026-11-10")).toEqual({
      charge: ["2026-09", "2026-10"],
      nextMonth: "2026-11",
    });
  });

  it("CA4: paused skips the months (the cursor moves); canceled does nothing", () => {
    expect(dueMonths({ ...active, status: "PAUSED", nextMonth: "2026-09" }, "2026-11-20")).toEqual({
      charge: [],
      nextMonth: "2026-12",
    });
    expect(
      dueMonths({ ...active, status: "CANCELED", nextMonth: "2026-09" }, "2026-11-20"),
    ).toEqual({
      charge: [],
      nextMonth: "2026-09",
    });
  });

  it("CA2: day 31 charges on the month's last day", () => {
    expect(dueMonths({ ...active, dayOfMonth: 31, nextMonth: "2026-02" }, "2026-04-30")).toEqual({
      charge: ["2026-02", "2026-03", "2026-04"],
      nextMonth: "2026-05",
    });
  });
});

describe("resumeMonth", () => {
  it("CA4: resumes on the first month whose charge hasn't passed", () => {
    expect(resumeMonth(15, "2026-11-10")).toBe("2026-11");
    expect(resumeMonth(15, "2026-11-15")).toBe("2026-11");
    expect(resumeMonth(15, "2026-11-16")).toBe("2026-12");
    expect(resumeMonth(31, "2026-02-28")).toBe("2026-02");
  });
});
