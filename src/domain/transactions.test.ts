import { describe, expect, it } from "vitest";

import { CYCLE_EPOCH, type CycleVersion } from "./invoice-cycle";
import {
  type EntryInput,
  type EntryRefs,
  recomputeInvoices,
  resolveInvoice,
  validateEntry,
} from "./transactions";

// Closes on the 5th, due on the 12th.
const cycles: CycleVersion[] = [{ closingDay: 5, dueDay: 12, validFrom: CYCLE_EPOCH }];

const archived = new Date("2026-10-01T12:00:00Z");

const refs: EntryRefs = {
  accounts: [
    { id: "azul", archivedAt: null },
    { id: "antiga", archivedAt: archived },
  ],
  cards: [
    { id: "roxo", archivedAt: null, cycles },
    { id: "velho", archivedAt: archived, cycles },
  ],
  categories: [
    { id: "mercado", type: "EXPENSE", archivedAt: null, parent: null },
    { id: "padaria", type: "EXPENSE", archivedAt: null, parent: { archivedAt: null } },
    { id: "salario", type: "INCOME", archivedAt: null, parent: null },
    { id: "extinta", type: "EXPENSE", archivedAt: archived, parent: null },
    { id: "orfa", type: "EXPENSE", archivedAt: null, parent: { archivedAt: archived } },
  ],
};

const today = "2026-10-31";

function pix(overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    type: "EXPENSE",
    amountCents: 1_000,
    date: "2026-10-20",
    method: "PIX",
    accountId: "azul",
    cardId: null,
    invoiceDueDate: null,
    categoryId: "mercado",
    counterparty: null,
    description: null,
    ...overrides,
  };
}

function credit(overrides: Partial<EntryInput> = {}): EntryInput {
  return pix({ method: "CREDIT", accountId: null, cardId: "roxo", ...overrides });
}

describe("validateEntry", () => {
  it("accepts a Pix expense; it has no invoice", () => {
    expect(validateEntry(pix(), refs, { today })).toEqual({ ok: true, invoice: null });
  });

  it("accepts an expense without category, and a parent or child category", () => {
    expect(validateEntry(pix({ categoryId: null }), refs, { today }).ok).toBe(true);
    expect(validateEntry(pix({ categoryId: "padaria" }), refs, { today }).ok).toBe(true);
  });

  it("puts a credit purchase on the invoice of its date", () => {
    expect(validateEntry(credit({ date: "2026-10-04" }), refs, { today })).toEqual({
      ok: true,
      invoice: { invoiceDueDate: "2026-10-12", invoiceOverridden: false },
    });
    // On the closing day: the next invoice.
    expect(validateEntry(credit({ date: "2026-10-05" }), refs, { today })).toEqual({
      ok: true,
      invoice: { invoiceDueDate: "2026-11-12", invoiceOverridden: false },
    });
  });

  it("refuses a date in the future or before 2000, and accepts today", () => {
    expect(validateEntry(pix({ date: "2026-11-01" }), refs, { today })).toEqual({
      ok: false,
      error: "FUTURE_DATE",
    });
    expect(validateEntry(pix({ date: "1999-12-31" }), refs, { today })).toEqual({
      ok: false,
      error: "DATE_TOO_OLD",
    });
    expect(validateEntry(pix({ date: today }), refs, { today }).ok).toBe(true);
  });

  it("an income takes Pix, TED, cash or boleto; not credit or debit", () => {
    const income = (method: EntryInput["method"]) =>
      validateEntry(pix({ type: "INCOME", method, categoryId: "salario" }), refs, { today });
    for (const method of ["PIX", "TED", "CASH", "BOLETO"] as const) {
      expect(income(method).ok).toBe(true);
    }
    expect(income("DEBIT")).toEqual({ ok: false, error: "METHOD_NOT_ALLOWED" });
    expect(
      validateEntry(credit({ type: "INCOME", categoryId: "salario" }), refs, { today }),
    ).toEqual({ ok: false, error: "METHOD_NOT_ALLOWED" });
  });

  it("refuses an account or card outside the space, and archived ones on a new choice", () => {
    expect(validateEntry(pix({ accountId: "outra" }), refs, { today })).toEqual({
      ok: false,
      error: "ACCOUNT_NOT_FOUND",
    });
    expect(validateEntry(pix({ accountId: "antiga" }), refs, { today })).toEqual({
      ok: false,
      error: "ACCOUNT_ARCHIVED",
    });
    expect(validateEntry(credit({ cardId: "outro" }), refs, { today })).toEqual({
      ok: false,
      error: "CARD_NOT_FOUND",
    });
    expect(validateEntry(credit({ cardId: "velho" }), refs, { today })).toEqual({
      ok: false,
      error: "CARD_ARCHIVED",
    });
  });

  it("an edited entry may keep the account, card and category it already had, even archived", () => {
    const current = { accountId: "antiga", cardId: "velho", categoryId: "extinta" };
    expect(
      validateEntry(pix({ accountId: "antiga", categoryId: "extinta" }), refs, { today, current })
        .ok,
    ).toBe(true);
    expect(
      validateEntry(credit({ cardId: "velho", categoryId: "extinta" }), refs, { today, current })
        .ok,
    ).toBe(true);
  });

  it("refuses a category outside the space, archived (or under an archived parent), or of the other type", () => {
    expect(validateEntry(pix({ categoryId: "outra" }), refs, { today })).toEqual({
      ok: false,
      error: "CATEGORY_NOT_FOUND",
    });
    expect(validateEntry(pix({ categoryId: "extinta" }), refs, { today })).toEqual({
      ok: false,
      error: "CATEGORY_ARCHIVED",
    });
    expect(validateEntry(pix({ categoryId: "orfa" }), refs, { today })).toEqual({
      ok: false,
      error: "CATEGORY_ARCHIVED",
    });
    expect(validateEntry(pix({ categoryId: "salario" }), refs, { today })).toEqual({
      ok: false,
      error: "CATEGORY_TYPE_MISMATCH",
    });
    expect(validateEntry(pix({ type: "INCOME", categoryId: "mercado" }), refs, { today })).toEqual({
      ok: false,
      error: "CATEGORY_TYPE_MISMATCH",
    });
  });

  it("an edit that changes the type can't keep a category of the old type", () => {
    const current = { accountId: "azul", cardId: null, categoryId: "mercado" };
    expect(
      validateEntry(pix({ type: "INCOME", categoryId: "mercado" }), refs, { today, current }),
    ).toEqual({ ok: false, error: "CATEGORY_TYPE_MISMATCH" });
  });

  it("takes a manually chosen invoice within the window and refuses one outside it", () => {
    expect(
      validateEntry(credit({ date: "2026-10-04", invoiceDueDate: "2026-11-12" }), refs, { today }),
    ).toEqual({ ok: true, invoice: { invoiceDueDate: "2026-11-12", invoiceOverridden: true } });
    expect(
      validateEntry(credit({ date: "2026-10-04", invoiceDueDate: "2026-11-13" }), refs, { today }),
    ).toEqual({ ok: false, error: "INVALID_INVOICE" });
  });
});

describe("resolveInvoice", () => {
  const date = "2026-10-20"; // computed invoice: closes 05/11, due 12/11

  it("without a choice, the computed invoice", () => {
    expect(resolveInvoice(cycles, date, null)).toEqual({
      ok: true,
      invoiceDueDate: "2026-11-12",
      invoiceOverridden: false,
    });
  });

  it("choosing the computed invoice is not an override", () => {
    expect(resolveInvoice(cycles, date, "2026-11-12")).toEqual({
      ok: true,
      invoiceDueDate: "2026-11-12",
      invoiceOverridden: false,
    });
  });

  it("accepts up to 3 invoices before or after, across the year", () => {
    for (const due of [
      "2026-08-12",
      "2026-09-12",
      "2026-10-12",
      "2026-12-12",
      "2027-01-12",
      "2027-02-12",
    ]) {
      expect(resolveInvoice(cycles, date, due)).toEqual({
        ok: true,
        invoiceDueDate: due,
        invoiceOverridden: true,
      });
    }
    for (const due of ["2026-07-12", "2027-03-12", "2026-11-11", "2026-11-05"]) {
      expect(resolveInvoice(cycles, date, due)).toEqual({ ok: false, error: "INVALID_INVOICE" });
    }
  });

  it("uses the cycle valid on the purchase date", () => {
    const changed: CycleVersion[] = [
      ...cycles,
      { closingDay: 20, dueDay: 27, validFrom: "2026-10-10" },
    ];
    expect(resolveInvoice(changed, "2026-10-08", null)).toMatchObject({
      invoiceDueDate: "2026-11-12",
    });
    expect(resolveInvoice(changed, "2026-10-12", null)).toMatchObject({
      invoiceDueDate: "2026-10-27",
    });
  });

  it("clamps short months: closing on the 31st, due on the 7th", () => {
    const end: CycleVersion[] = [{ closingDay: 31, dueDay: 7, validFrom: CYCLE_EPOCH }];
    // February closes on the 28th; a purchase on 02-28 goes to the March invoice.
    expect(resolveInvoice(end, "2027-02-27", null)).toMatchObject({ invoiceDueDate: "2027-03-07" });
    expect(resolveInvoice(end, "2027-02-28", null)).toMatchObject({ invoiceDueDate: "2027-04-07" });
  });
});

describe("recomputeInvoices", () => {
  const changed: CycleVersion[] = [{ closingDay: 25, dueDay: 5, validFrom: CYCLE_EPOCH }];

  it("returns the purchases whose computed invoice changed", () => {
    const purchases = [
      { id: "a", date: "2026-10-20", invoiceDueDate: "2026-11-12" }, // now closes 25/10, due 05/11
      { id: "b", date: "2026-10-26", invoiceDueDate: "2026-11-12" }, // now 05/12
      { id: "c", date: "2026-10-03", invoiceDueDate: "2026-11-05" }, // already right
    ];
    expect(recomputeInvoices(changed, purchases)).toEqual([
      { id: "a", invoiceDueDate: "2026-11-05" },
      { id: "b", invoiceDueDate: "2026-12-05" },
    ]);
  });
});
