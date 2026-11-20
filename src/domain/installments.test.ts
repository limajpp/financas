import { describe, expect, it } from "vitest";

import { CYCLE_EPOCH, type CycleVersion, invoiceFor, shiftInvoice } from "./invoice-cycle";
import { closingDateFor } from "./invoices";
import {
  INSTALLMENTS_MAX,
  INSTALLMENTS_MIN,
  planInstallments,
  installmentInvoiceWindow,
  replanGroupInvoices,
  shiftGroupInvoices,
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

describe("shiftGroupInvoices (task 18)", () => {
  // Bought 2026-10-20 in 4×: due 11-10, 12-10, 01-10, 02-10.
  const rows = [
    { id: "a", number: 1, date: "2026-10-20", invoiceDueDate: "2026-11-10" },
    { id: "b", number: 2, date: "2026-11-20", invoiceDueDate: "2026-12-10" },
    { id: "c", number: 3, date: "2026-12-20", invoiceDueDate: "2027-01-10" },
    { id: "d", number: 4, date: "2027-01-20", invoiceDueDate: "2027-02-10" },
  ];

  it("CA4: moving the 2nd one invoice later takes the 3rd and the 4th along; the 1st stays", () => {
    expect(shiftGroupInvoices(rows, cycles, { number: 2, invoiceDueDate: "2027-01-10" })).toEqual({
      ok: true,
      updates: [
        { id: "b", invoiceDueDate: "2027-01-10", invoiceOverridden: true },
        { id: "c", invoiceDueDate: "2027-02-10", invoiceOverridden: true },
        { id: "d", invoiceDueDate: "2027-03-10", invoiceOverridden: true },
      ],
    });
  });

  it("moving earlier works the same way", () => {
    const result = shiftGroupInvoices(rows, cycles, { number: 1, invoiceDueDate: "2026-10-10" });
    expect(result).toEqual({
      ok: true,
      updates: [
        { id: "a", invoiceDueDate: "2026-10-10", invoiceOverridden: true },
        { id: "b", invoiceDueDate: "2026-11-10", invoiceOverridden: true },
        { id: "c", invoiceDueDate: "2026-12-10", invoiceOverridden: true },
        { id: "d", invoiceDueDate: "2027-01-10", invoiceOverridden: true },
      ],
    });
  });

  it("never onto the invoice of the installment before, nor earlier", () => {
    for (const invoiceDueDate of ["2026-12-10", "2026-11-10"]) {
      expect(shiftGroupInvoices(rows, cycles, { number: 3, invoiceDueDate })).toEqual({
        ok: false,
        error: "INSTALLMENT_ORDER",
      });
    }
    // With the 2nd deleted, the 3rd may take its invoice.
    expect(
      shiftGroupInvoices(
        rows.filter((r) => r.number !== 2),
        cycles,
        { number: 3, invoiceDueDate: "2026-12-10" },
      ).ok,
    ).toBe(true);
  });

  it("moving back to the computed invoice is no longer a manual choice", () => {
    const moved = [
      rows[0]!,
      { ...rows[1]!, invoiceDueDate: "2027-01-10" },
      { ...rows[2]!, invoiceDueDate: "2027-02-10" },
      { ...rows[3]!, invoiceDueDate: "2027-03-10" },
    ];
    expect(shiftGroupInvoices(moved, cycles, { number: 2, invoiceDueDate: "2026-12-10" })).toEqual({
      ok: true,
      updates: [
        { id: "b", invoiceDueDate: "2026-12-10", invoiceOverridden: false },
        { id: "c", invoiceDueDate: "2027-01-10", invoiceOverridden: false },
        { id: "d", invoiceDueDate: "2027-02-10", invoiceOverridden: false },
      ],
    });
  });

  it("the chosen invoice must be up to 3 invoices away from the computed one", () => {
    expect(shiftGroupInvoices(rows, cycles, { number: 2, invoiceDueDate: "2027-03-10" }).ok).toBe(
      true,
    );
    expect(shiftGroupInvoices(rows, cycles, { number: 2, invoiceDueDate: "2027-04-10" })).toEqual({
      ok: false,
      error: "INVALID_INVOICE",
    });
    expect(shiftGroupInvoices(rows, cycles, { number: 2, invoiceDueDate: "2026-12-11" })).toEqual({
      ok: false,
      error: "INVALID_INVOICE",
    });
  });

  it("the window is around the computed invoice, not the current one", () => {
    // Already 3 invoices later: one more is out of the window.
    const moved = rows.map((r) =>
      r.number >= 2
        ? {
            ...r,
            invoiceDueDate: shiftInvoice(cycles[0]!, invoiceFor(cycles[0]!, r.date), 3).dueDate,
          }
        : r,
    );
    expect(shiftGroupInvoices(moved, cycles, { number: 2, invoiceDueDate: "2027-04-10" }).ok).toBe(
      false,
    );
  });
});

describe("installmentInvoiceWindow (task 18)", () => {
  it("the window is around the group's sequence, even when the date was shortened in February", () => {
    // Closes on the 30th, due on the 7th; bought on 2026-01-29 in 3×.
    const late: CycleVersion[] = [{ closingDay: 30, dueDay: 7, validFrom: CYCLE_EPOCH }];
    const plan = planInstallments({ date: "2026-01-29", amountCents: 300 }, 3, late);
    const rows = plan.map((p, i) => ({ id: String(i), ...p }));
    const second = rows[1]!;
    expect(second.date).toBe("2026-02-28");
    // By its own (shortened) date the 2nd would fall one invoice later than in the sequence.
    expect(invoiceFor(late[0]!, second.date).dueDate).not.toBe(second.invoiceDueDate);

    const window = installmentInvoiceWindow(late, {
      dueDate: second.invoiceDueDate,
      closingDate: closingDateFor(late, second.invoiceDueDate), // what the edit dialog uses
    }).map((i) => i.dueDate);
    expect(window).toHaveLength(7);
    expect(window[3]).toBe(second.invoiceDueDate);
    // Every invoice of the window after the 1st's is accepted by the server.
    for (const due of window.filter((d) => d > rows[0]!.invoiceDueDate)) {
      expect(shiftGroupInvoices(rows, late, { number: 2, invoiceDueDate: due }).ok).toBe(true);
    }
    expect(shiftGroupInvoices(rows, late, { number: 2, invoiceDueDate: window.at(-1)! }).ok).toBe(
      true,
    );
  });
});
