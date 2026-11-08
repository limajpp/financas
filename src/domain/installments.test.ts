import { describe, expect, it } from "vitest";

import { CYCLE_EPOCH, type CycleVersion, invoiceFor, shiftInvoice } from "./invoice-cycle";
import {
  INSTALLMENTS_MAX,
  INSTALLMENTS_MIN,
  planInstallments,
  replanGroupInvoices,
  splitAmount,
} from "./installments";

// Closes on the 3rd, due on the 10th.
const cycles: CycleVersion[] = [{ closingDay: 3, dueDay: 10, validFrom: CYCLE_EPOCH }];

describe("splitAmount", () => {
  it("CA1: the leftover cents go to the 1st installment", () => {
    expect(splitAmount(100_001, 10)).toEqual([10_001, ...Array(9).fill(10_000)]);
    expect(splitAmount(10_000, 3)).toEqual([3_334, 3_333, 3_333]);
    expect(splitAmount(30_000, 3)).toEqual([10_000, 10_000, 10_000]);
  });

  it("CA3: always adds up to the total; at least 1 cent each; only the 1st may differ", () => {
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647);
    for (let n = INSTALLMENTS_MIN; n <= INSTALLMENTS_MAX; n++) {
      const totals = [n, n + 1, 2 * n - 1, 99_999, 2_000_000_000];
      for (let k = 0; k < 300; k++) totals.push(n + (random() % 50_000_000));
      for (const total of totals) {
        const parts = splitAmount(total, n);
        expect(parts).toHaveLength(n);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.min(...parts)).toBeGreaterThanOrEqual(1);
        expect(new Set(parts.slice(1)).size).toBeLessThanOrEqual(1);
        expect(parts[0]! - parts[1]!).toBeGreaterThanOrEqual(0);
        expect(parts[0]! - parts[1]!).toBeLessThan(n);
      }
    }
  });

  it("refuses less than a cent per installment, and a count outside 2–24", () => {
    expect(() => splitAmount(5, 10)).toThrow(RangeError);
    expect(() => splitAmount(1_000, 1)).toThrow(RangeError);
    expect(() => splitAmount(1_000, 25)).toThrow(RangeError);
  });
});

describe("planInstallments", () => {
  it("CA2: dates from the original day; days the month lacks become its last day", () => {
    const plan = planInstallments({ date: "2026-01-31", amountCents: 40_000 }, 4, cycles);
    expect(plan.map((p) => p.date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
    const leap = planInstallments({ date: "2028-01-31", amountCents: 20_000 }, 2, cycles);
    expect(leap.map((p) => p.date)).toEqual(["2028-01-31", "2028-02-29"]);
  });

  it("numbers, amounts and one invoice after another", () => {
    expect(planInstallments({ date: "2026-11-08", amountCents: 30_001 }, 3, cycles)).toEqual([
      { number: 1, amountCents: 10_001, date: "2026-11-08", invoiceDueDate: "2026-12-10" },
      { number: 2, amountCents: 10_000, date: "2026-12-08", invoiceDueDate: "2027-01-10" },
      { number: 3, amountCents: 10_000, date: "2027-01-08", invoiceDueDate: "2027-02-10" },
    ]);
  });

  it("CA4: with one cycle, installment i is shiftInvoice(purchase invoice, i − 1), for every cycle", () => {
    for (let closingDay = 1; closingDay <= 31; closingDay += 2) {
      for (let dueDay = 1; dueDay <= 31; dueDay += 2) {
        const c = { closingDay, dueDay };
        const versions = [{ ...c, validFrom: CYCLE_EPOCH }];
        for (const date of ["2026-01-29", "2026-01-31", "2026-02-28", "2026-12-15"]) {
          const first = invoiceFor(c, date);
          const plan = planInstallments({ date, amountCents: 1_200 }, 12, versions);
          plan.forEach((p, i) => expect(p.invoiceDueDate).toBe(shiftInvoice(c, first, i).dueDate));
        }
      }
    }
  });

  it("on the closing day, the 1st installment already goes to the next invoice", () => {
    const plan = planInstallments({ date: "2026-11-03", amountCents: 200 }, 2, cycles);
    expect(plan.map((p) => p.invoiceDueDate)).toEqual(["2026-12-10", "2027-01-10"]);
  });
});

describe("replanGroupInvoices", () => {
  // Bought 2026-10-20 in 4×: due 11-10, 12-10, 01-10, 02-10. Then 20/27 from 2026-11-10.
  const changed: CycleVersion[] = [
    ...cycles,
    { closingDay: 20, dueDay: 27, validFrom: "2026-11-10" },
  ];
  const rows = [
    { id: "a", number: 1, date: "2026-10-20", invoiceDueDate: "2026-11-10" },
    { id: "b", number: 2, date: "2026-11-20", invoiceDueDate: "2026-12-10" },
    { id: "c", number: 3, date: "2026-12-20", invoiceDueDate: "2027-01-10" },
    { id: "d", number: 4, date: "2027-01-20", invoiceDueDate: "2027-02-10" },
  ];

  it("CA4: the ones left move to the new cycle's invoices, one per invoice", () => {
    expect(replanGroupInvoices(rows, changed)).toEqual([
      { id: "b", invoiceDueDate: "2026-11-27" },
      { id: "c", invoiceDueDate: "2026-12-27" },
      { id: "d", invoiceDueDate: "2027-01-27" },
    ]);
  });

  it("nothing changes without a cycle change", () => {
    expect(replanGroupInvoices(rows, cycles)).toEqual([]);
  });

  it("starts from the lowest installment left when the earlier ones were deleted", () => {
    // The 3rd keeps its own invoice (01-10); the 4th follows it under the new cycle.
    expect(replanGroupInvoices(rows.slice(2), changed)).toEqual([
      { id: "d", invoiceDueDate: "2027-01-27" },
    ]);
  });
});
