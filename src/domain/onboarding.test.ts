import { describe, expect, it } from "vitest";

import { CYCLE_EPOCH, type CycleVersion } from "./invoice-cycle";
import {
  firstChargeMonth,
  ongoingClientId,
  ongoingInstallments,
  openingBalanceCents,
  openingInvoices,
  validateOngoing,
} from "./onboarding";

// Closes on the 3rd, due on the 10th.
const cycles: CycleVersion[] = [{ closingDay: 3, dueDay: 10, validFrom: CYCLE_EPOCH }];

describe("ongoingInstallments", () => {
  it("CA1: 3 de 10 de R$ 150 gera as parcelas 3 a 10, uma por fatura, a partir da aberta", () => {
    const plan = ongoingInstallments(
      { current: 3, total: 10, amountCents: 15_000 },
      cycles,
      "2026-11-15",
    );
    expect(plan).toHaveLength(8);
    expect(plan.map((p) => p.number)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(plan.every((p) => p.amountCents === 15_000)).toBe(true);
    // Today (15/11) is after the closing on the 3rd: the open invoice closes on 03/12, due 10/12.
    expect(plan.map((p) => p.invoiceDueDate)).toEqual([
      "2026-12-10",
      "2027-01-10",
      "2027-02-10",
      "2027-03-10",
      "2027-04-10",
      "2027-05-10",
      "2027-06-10",
      "2027-07-10",
    ]);
    // Bought 2 months ago (15/09): installment k is dated k − 1 months later.
    expect(plan.map((p) => p.date)).toEqual([
      "2026-11-15",
      "2026-12-15",
      "2027-01-15",
      "2027-02-15",
      "2027-03-15",
      "2027-04-15",
      "2027-05-15",
      "2027-06-15",
    ]);
  });

  it("uma compra de fim de mês fica no último dia dos meses mais curtos", () => {
    const plan = ongoingInstallments(
      { current: 2, total: 3, amountCents: 1_000 },
      cycles,
      "2027-03-31",
    );
    // Bought 28/02 (31/02 doesn't exist): installment 2 is 28/03, 3 is 28/04.
    expect(plan.map((p) => p.date)).toEqual(["2027-03-28", "2027-04-28"]);
    expect(plan.map((p) => p.invoiceDueDate)).toEqual(["2027-04-10", "2027-05-10"]);
  });

  it("1 de N começa hoje, na fatura aberta", () => {
    const plan = ongoingInstallments(
      { current: 1, total: 2, amountCents: 5_000 },
      cycles,
      "2026-11-02",
    );
    expect(plan).toEqual([
      { number: 1, amountCents: 5_000, date: "2026-11-02", invoiceDueDate: "2026-11-10" },
      { number: 2, amountCents: 5_000, date: "2026-12-02", invoiceDueDate: "2026-12-10" },
    ]);
  });

  it("recusa o que não é um parcelamento em andamento", () => {
    expect(() =>
      ongoingInstallments({ current: 1, total: 1, amountCents: 100 }, cycles, "2026-11-15"),
    ).toThrow(RangeError);
  });
});

describe("validateOngoing", () => {
  it.each([
    [{ current: 1, total: 1, amountCents: 100 }, "INVALID_INSTALLMENTS"],
    [{ current: 0, total: 10, amountCents: 100 }, "INVALID_INSTALLMENTS"],
    [{ current: 11, total: 10, amountCents: 100 }, "INVALID_INSTALLMENTS"],
    [{ current: 2, total: 25, amountCents: 100 }, "INVALID_INSTALLMENTS"],
    [{ current: 1.5, total: 10, amountCents: 100 }, "INVALID_INSTALLMENTS"],
    [{ current: 10, total: 10, amountCents: 100 }, "LAST_INSTALLMENT"],
    [{ current: 3, total: 10, amountCents: 0 }, "INVALID_AMOUNT"],
    [{ current: 3, total: 10, amountCents: 2_000_000_001 }, "INVALID_AMOUNT"],
  ])("CA4: recusa %o", (input, error) => {
    expect(validateOngoing(input)).toEqual({ ok: false, error });
  });

  it("aceita do 1 ao penúltimo, até 24 parcelas", () => {
    expect(validateOngoing({ current: 1, total: 2, amountCents: 1 })).toEqual({ ok: true });
    expect(validateOngoing({ current: 23, total: 24, amountCents: 1 })).toEqual({ ok: true });
  });
});

describe("ongoingClientId", () => {
  it("a parcela atual leva o id; as outras, id:N", () => {
    expect(ongoingClientId("abc", 3, 3)).toBe("onboarding:abc");
    expect(ongoingClientId("abc", 4, 3)).toBe("onboarding:abc:4");
  });
});

describe("firstChargeMonth", () => {
  it("CA3: a primeira cobrança é a primeira data depois de hoje", () => {
    expect(firstChargeMonth(8, "2026-11-15")).toBe("2026-12");
    expect(firstChargeMonth(20, "2026-11-15")).toBe("2026-11");
  });

  it("a cobrança de hoje já está no saldo: começa no mês que vem", () => {
    expect(firstChargeMonth(15, "2026-11-15")).toBe("2026-12");
  });

  it("dia 31 em novembro é o dia 30", () => {
    expect(firstChargeMonth(31, "2026-11-29")).toBe("2026-11");
    expect(firstChargeMonth(31, "2026-11-30")).toBe("2026-12");
  });

  it("vira o ano", () => {
    expect(firstChargeMonth(5, "2026-12-20")).toBe("2027-01");
  });
});

describe("openingInvoices", () => {
  it("antes do vencimento da fechada, pergunta pelas duas", () => {
    // 05/11: the invoice that closed on 03/11 is due on 10/11.
    expect(openingInvoices(cycles, "2026-11-05")).toEqual({
      open: { closingDate: "2026-12-03", dueDate: "2026-12-10" },
      closed: { closingDate: "2026-11-03", dueDate: "2026-11-10" },
    });
  });

  it("no dia do vencimento, a fechada ainda conta", () => {
    expect(openingInvoices(cycles, "2026-11-10").closed?.dueDate).toBe("2026-11-10");
  });

  it("depois do vencimento, só a aberta", () => {
    expect(openingInvoices(cycles, "2026-11-15")).toEqual({
      open: { closingDate: "2026-12-03", dueDate: "2026-12-10" },
      closed: null,
    });
  });

  it("com vencimento antes do fechamento, a fechada vence no mês seguinte", () => {
    // Closes on the 25th, due on the 5th of the next month.
    const late: CycleVersion[] = [{ closingDay: 25, dueDay: 5, validFrom: CYCLE_EPOCH }];
    expect(openingInvoices(late, "2026-11-28")).toEqual({
      open: { closingDate: "2026-12-25", dueDate: "2027-01-05" },
      closed: { closingDate: "2026-11-25", dueDate: "2026-12-05" },
    });
  });
});

describe("openingBalanceCents", () => {
  it("CA2: tira as parcelas já cadastradas daquela fatura, sem ficar negativo", () => {
    expect(openingBalanceCents(100_000, 15_000)).toBe(85_000);
    expect(openingBalanceCents(10_000, 15_000)).toBe(0);
    expect(openingBalanceCents(0, 0)).toBe(0);
  });
});
