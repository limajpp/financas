import { describe, expect, it } from "vitest";

import { CYCLE_EPOCH, type CycleVersion } from "./invoice-cycle";
import { defaultInvoiceToPay, invoiceSummaries, isPayableInvoice } from "./invoices";

// Closes on the 3rd, due on the 10th.
const cycles: CycleVersion[] = [{ closingDay: 3, dueDay: 10, validFrom: CYCLE_EPOCH }];
const today = "2026-11-08"; // open invoice: closes 03/12, due 10/12

describe("invoiceSummaries", () => {
  const purchases = [
    { invoiceDueDate: "2026-10-10", amountCents: 10_000 },
    { invoiceDueDate: "2026-11-10", amountCents: 30_000 },
    { invoiceDueDate: "2026-11-10", amountCents: 20_000 },
    { invoiceDueDate: "2026-12-10", amountCents: 5_000 },
  ];
  const payments = [
    { invoiceDueDate: "2026-10-10", amountCents: 10_000 }, // paid in full
    { invoiceDueDate: "2026-11-10", amountCents: 20_000 }, // partial
  ];

  it("totals, paid and remaining per invoice, oldest first, with the closing and the status", () => {
    expect(invoiceSummaries(purchases, payments, cycles, today)).toEqual([
      {
        dueDate: "2026-10-10",
        closingDate: "2026-10-03",
        totalCents: 10_000,
        paidCents: 10_000,
        remainingCents: 0,
        status: "closed",
      },
      {
        dueDate: "2026-11-10",
        closingDate: "2026-11-03",
        totalCents: 50_000,
        paidCents: 20_000,
        remainingCents: 30_000,
        status: "closed",
      },
      {
        dueDate: "2026-12-10",
        closingDate: "2026-12-03",
        totalCents: 5_000,
        paidCents: 0,
        remainingCents: 5_000,
        status: "open",
      },
    ]);
  });

  it("an overpaid invoice has a negative remaining (credit)", () => {
    const [summary] = invoiceSummaries(
      [{ invoiceDueDate: "2026-11-10", amountCents: 1_000 }],
      [{ invoiceDueDate: "2026-11-10", amountCents: 6_000 }],
      cycles,
      today,
    );
    expect(summary?.remainingCents).toBe(-5_000);
  });

  it("always lists the open invoice, even empty", () => {
    expect(invoiceSummaries([], [], cycles, today)).toEqual([
      {
        dueDate: "2026-12-10",
        closingDate: "2026-12-03",
        totalCents: 0,
        paidCents: 0,
        remainingCents: 0,
        status: "open",
      },
    ]);
  });

  it("an invoice is open until its closing day; on the closing day it's closed", () => {
    const purchase = [{ invoiceDueDate: "2026-12-10", amountCents: 1 }];
    expect(invoiceSummaries(purchase, [], cycles, "2026-12-02")[0]).toMatchObject({
      dueDate: "2026-12-10",
      status: "open",
    });
    const onClosing = invoiceSummaries(purchase, [], cycles, "2026-12-03");
    expect(onClosing[0]).toMatchObject({ dueDate: "2026-12-10", status: "closed" });
    expect(onClosing.at(-1)).toMatchObject({ dueDate: "2027-01-10", status: "open" });
  });

  it("invoices after the open one are future (installments)", () => {
    const installments = ["2026-12-10", "2027-01-10", "2027-02-10"].map((invoiceDueDate) => ({
      invoiceDueDate,
      amountCents: 100,
    }));
    expect(invoiceSummaries(installments, [], cycles, today).map((s) => s.status)).toEqual([
      "open",
      "future",
      "future",
    ]);
  });

  it("when two versions give the same due date, the closing comes from the newer one", () => {
    // 3/10 until 2026-11-04, then 5/10: the invoice due 2026-12-10 closes on 12-05, not 12-03.
    const moved: CycleVersion[] = [
      ...cycles,
      { closingDay: 5, dueDay: 10, validFrom: "2026-11-04" },
    ];
    const [summary] = invoiceSummaries(
      [{ invoiceDueDate: "2026-12-10", amountCents: 1 }],
      [],
      moved,
      "2026-12-04",
    );
    expect(summary).toMatchObject({ closingDate: "2026-12-05", status: "open" });
    // A version that starts after the closing it would give doesn't count.
    const late: CycleVersion[] = [
      ...cycles,
      { closingDay: 5, dueDay: 10, validFrom: "2026-12-06" },
    ];
    expect(
      invoiceSummaries(
        [{ invoiceDueDate: "2026-12-10", amountCents: 1 }],
        [],
        late,
        "2026-12-04",
      )[0]?.closingDate,
    ).toBe("2026-12-03");
  });

  it("uses the cycle version that produced each due date", () => {
    // Changed to closing 20 / due 27 from 2026-10-15; older invoices keep the old days.
    const changed: CycleVersion[] = [
      ...cycles,
      { closingDay: 20, dueDay: 27, validFrom: "2026-10-15" },
    ];
    const summaries = invoiceSummaries(
      [
        { invoiceDueDate: "2026-11-10", amountCents: 1 },
        { invoiceDueDate: "2026-10-27", amountCents: 1 },
      ],
      [],
      changed,
      today,
    );
    expect(summaries.map((s) => [s.dueDate, s.closingDate])).toEqual([
      ["2026-10-27", "2026-10-20"],
      ["2026-11-10", "2026-11-03"],
      ["2026-11-27", "2026-11-20"],
    ]);
  });
});

describe("isPayableInvoice", () => {
  it("an invoice with purchases, the open one, the next one or one of the 12 before", () => {
    expect(isPayableInvoice("2020-01-10", ["2020-01-10"], cycles, today)).toBe(true);
    expect(isPayableInvoice("2026-12-10", [], cycles, today)).toBe(true); // open
    expect(isPayableInvoice("2027-01-10", [], cycles, today)).toBe(true); // next
    expect(isPayableInvoice("2025-12-10", [], cycles, today)).toBe(true); // 12 before
  });

  it("not further away, nor a date that isn't a due date of the card", () => {
    expect(isPayableInvoice("2027-02-10", [], cycles, today)).toBe(false);
    expect(isPayableInvoice("2025-11-10", [], cycles, today)).toBe(false);
    expect(isPayableInvoice("2026-11-11", [], cycles, today)).toBe(false);
  });
});

describe("defaultInvoiceToPay", () => {
  const summary = (
    dueDate: string,
    remainingCents: number,
    status: "closed" | "open" | "future" = "closed",
  ) => ({
    dueDate,
    closingDate: "",
    totalCents: remainingCents,
    paidCents: 0,
    remainingCents,
    status,
  });

  it("the oldest closed invoice with something to pay", () => {
    expect(
      defaultInvoiceToPay([
        summary("2026-10-10", 0),
        summary("2026-11-10", 300),
        summary("2026-12-10", 100, "open"),
      ]),
    ).toBe("2026-11-10");
  });

  it("a future invoice is never the default over the open one", () => {
    expect(
      defaultInvoiceToPay([summary("2026-12-10", 0, "open"), summary("2027-01-10", 500, "future")]),
    ).toBe("2026-12-10");
  });

  it("else the open one", () => {
    expect(
      defaultInvoiceToPay([summary("2026-11-10", -50), summary("2026-12-10", 0, "open")]),
    ).toBe("2026-12-10");
  });
});
