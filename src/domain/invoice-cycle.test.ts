import { describe, expect, it } from "vitest";

import {
  CYCLE_EPOCH,
  cycleOn,
  type InvoiceCycle,
  invoiceFor,
  isCycleDay,
  shiftInvoice,
} from "./invoice-cycle";

const cycle = (closingDay: number, dueDay: number): InvoiceCycle => ({ closingDay, dueDay });

type Case = [purchase: string, closing: string, due: string];

function check(c: InvoiceCycle, cases: Case[]) {
  for (const [purchase, closingDate, dueDate] of cases) {
    expect(invoiceFor(c, purchase), `compra em ${purchase}`).toEqual({ closingDate, dueDate });
  }
}

describe("invoiceFor", () => {
  it("fecha 3, vence 10: antes, no dia e depois do fechamento; virada de ano", () => {
    check(cycle(3, 10), [
      ["2026-10-02", "2026-10-03", "2026-10-10"],
      ["2026-10-03", "2026-11-03", "2026-11-10"],
      ["2026-10-04", "2026-11-03", "2026-11-10"],
      ["2026-12-02", "2026-12-03", "2026-12-10"],
      ["2026-12-28", "2027-01-03", "2027-01-10"],
      ["2026-12-31", "2027-01-03", "2027-01-10"],
    ]);
  });

  it("fecha 25, vence 5: o vencimento cai no mês seguinte, inclusive na virada de ano", () => {
    check(cycle(25, 5), [
      ["2026-10-24", "2026-10-25", "2026-11-05"],
      ["2026-10-25", "2026-11-25", "2026-12-05"],
      ["2026-11-30", "2026-12-25", "2027-01-05"],
      ["2026-12-26", "2027-01-25", "2027-02-05"],
      ["2027-01-24", "2027-01-25", "2027-02-05"],
    ]);
  });

  it("fecha 31, vence 7: meses curtos e fevereiro (2026 não bissexto, 2028 bissexto)", () => {
    check(cycle(31, 7), [
      ["2026-01-30", "2026-01-31", "2026-02-07"],
      ["2026-01-31", "2026-02-28", "2026-03-07"],
      ["2026-02-27", "2026-02-28", "2026-03-07"],
      ["2026-02-28", "2026-03-31", "2026-04-07"],
      ["2026-04-29", "2026-04-30", "2026-05-07"],
      ["2026-04-30", "2026-05-31", "2026-06-07"],
      ["2026-12-31", "2027-01-31", "2027-02-07"],
      ["2028-02-28", "2028-02-29", "2028-03-07"],
      ["2028-02-29", "2028-03-31", "2028-04-07"],
    ]);
  });

  it("fecha 30 e 29 em fevereiro", () => {
    check(cycle(30, 10), [
      ["2026-02-27", "2026-02-28", "2026-03-10"],
      ["2026-02-28", "2026-03-30", "2026-04-10"],
      ["2028-02-28", "2028-02-29", "2028-03-10"],
    ]);
    check(cycle(29, 10), [
      ["2026-02-28", "2026-03-29", "2026-04-10"],
      ["2028-02-28", "2028-02-29", "2028-03-10"],
      ["2028-02-29", "2028-03-29", "2028-04-10"],
    ]);
  });

  it("vencimento em 29–31 vira o último dia do mês", () => {
    check(cycle(5, 31), [
      ["2026-02-03", "2026-02-05", "2026-02-28"],
      ["2026-04-03", "2026-04-05", "2026-04-30"],
      ["2028-02-01", "2028-02-05", "2028-02-29"],
      ["2026-02-05", "2026-03-05", "2026-03-31"],
    ]);
    check(cycle(20, 30), [
      ["2026-02-10", "2026-02-20", "2026-02-28"],
      ["2028-02-10", "2028-02-20", "2028-02-29"],
    ]);
  });

  it("vencimento em 29–31 no mês seguinte ao fechamento: ajustado pelo mês do vencimento", () => {
    check(cycle(31, 30), [
      ["2026-01-15", "2026-01-31", "2026-02-28"],
      ["2026-01-31", "2026-02-28", "2026-03-30"],
      ["2026-02-10", "2026-02-28", "2026-03-30"],
      ["2028-01-15", "2028-01-31", "2028-02-29"],
    ]);
    check(cycle(30, 29), [
      ["2026-01-15", "2026-01-30", "2026-02-28"],
      ["2026-02-10", "2026-02-28", "2026-03-29"],
      ["2028-01-15", "2028-01-30", "2028-02-29"],
      ["2028-02-10", "2028-02-29", "2028-03-29"],
    ]);
    check(cycle(5, 29), [
      ["2026-02-01", "2026-02-05", "2026-02-28"],
      ["2028-02-01", "2028-02-05", "2028-02-29"],
    ]);
  });

  it("vencimento menor que o fechamento: vence no mês seguinte", () => {
    check(cycle(28, 3), [
      ["2026-02-27", "2026-02-28", "2026-03-03"],
      ["2026-02-28", "2026-03-28", "2026-04-03"],
    ]);
  });

  it("vencimento igual ao fechamento: vence no mês seguinte", () => {
    check(cycle(10, 10), [
      ["2026-10-09", "2026-10-10", "2026-11-10"],
      ["2026-10-10", "2026-11-10", "2026-12-10"],
    ]);
  });

  it("fechamento dia 1: só o próprio dia 1 já é da fatura seguinte", () => {
    check(cycle(1, 8), [
      ["2026-02-28", "2026-03-01", "2026-03-08"],
      ["2026-03-01", "2026-04-01", "2026-04-08"],
      ["2026-12-31", "2027-01-01", "2027-01-08"],
    ]);
  });

  it("fecha 28, vence 30 em fevereiro de 2026: fecha e vence no mesmo dia (caso raro, previsível)", () => {
    check(cycle(28, 30), [
      ["2026-02-10", "2026-02-28", "2026-02-28"],
      ["2026-03-10", "2026-03-28", "2026-03-30"],
    ]);
  });

  it("recusa dias fora de 1–31", () => {
    expect(() => invoiceFor(cycle(0, 10), "2026-10-01")).toThrow(RangeError);
    expect(() => invoiceFor(cycle(10, 32), "2026-10-01")).toThrow(RangeError);
    expect(() => invoiceFor(cycle(1.5, 10), "2026-10-01")).toThrow(RangeError);
    expect(isCycleDay(31)).toBe(true);
    expect(isCycleDay(0)).toBe(false);
  });
});

// ——— Properties over every cycle and every day of 2026–2028 ———

const DAY_MS = 24 * 60 * 60 * 1000;
const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
// ~1M comparisons: look day numbers up instead of parsing dates each time.
const dayNumber = new Map<string, number>();
for (let t = toUtc("2025-12-01"), n = 0; t <= toUtc("2029-12-31"); t += DAY_MS, n++) {
  dayNumber.set(new Date(t).toISOString().slice(0, 10), n);
}
const daysBetween = (a: string, b: string) => dayNumber.get(b)! - dayNumber.get(a)!;
const monthOf = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));

function* daysFrom(start: string, end: string) {
  for (let t = toUtc(start); t <= toUtc(end); t += DAY_MS) {
    yield new Date(t).toISOString().slice(0, 10);
  }
}

describe("propriedades (todas as combinações de dias, 2026–2028)", () => {
  const days = [...daysFrom("2026-01-01", "2028-12-31")];

  it("fechamento depois da compra (até 31 dias), vencimento não antes do fechamento, nada volta no tempo", () => {
    const failures: string[] = [];
    for (let closingDay = 1; closingDay <= 31; closingDay++) {
      for (let dueDay = 1; dueDay <= 31; dueDay++) {
        const c = cycle(closingDay, dueDay);
        let previous: { closingDate: string; dueDate: string } | null = null;
        for (const day of days) {
          const invoice = invoiceFor(c, day);
          const gap = daysBetween(day, invoice.closingDate);
          const label = `fecha ${closingDay}, vence ${dueDay}, compra ${day}`;
          if (gap < 1 || gap > 31) failures.push(`${label}: fecha ${gap} dias depois`);
          const dueGap = daysBetween(invoice.closingDate, invoice.dueDate);
          if (dueGap < 0 || dueGap > 62)
            failures.push(`${label}: vence ${dueGap} dias após fechar`);
          if (
            dueDay > closingDay
              ? monthOf(invoice.dueDate) !== monthOf(invoice.closingDate)
              : monthOf(invoice.dueDate) !== monthOf(invoice.closingDate) + 1
          ) {
            failures.push(`${label}: mês do vencimento errado`);
          }
          if (previous) {
            const step = monthOf(invoice.closingDate) - monthOf(previous.closingDate);
            // Next day: same invoice or the very next one; never back, never skipping one.
            if (step !== 0 && step !== 1) failures.push(`${label}: pulou ${step} faturas`);
            if (invoice.dueDate < previous.dueDate) failures.push(`${label}: voltou no tempo`);
          }
          previous = invoice;
          if (failures.length > 5) break;
        }
      }
    }
    expect(failures).toEqual([]);
  }, 30_000);

  it("fechamento e vencimento são sempre o dia configurado, ou o último do próprio mês", () => {
    const lastDay = (date: string) =>
      new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7), 0)).getUTCDate();
    const sample = days.filter((_, i) => i % 5 === 0);
    const failures: string[] = [];
    for (let closingDay = 1; closingDay <= 31; closingDay++) {
      for (let dueDay = 1; dueDay <= 31; dueDay++) {
        for (const day of sample) {
          const { closingDate, dueDate } = invoiceFor(cycle(closingDay, dueDay), day);
          if (Number(closingDate.slice(8)) !== Math.min(closingDay, lastDay(closingDate))) {
            failures.push(`fecha ${closingDay}, compra ${day}: fechou em ${closingDate}`);
          }
          if (Number(dueDate.slice(8)) !== Math.min(dueDay, lastDay(dueDate))) {
            failures.push(`vence ${dueDay}, compra ${day}: venceu em ${dueDate}`);
          }
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  }, 30_000);
});

describe("shiftInvoice", () => {
  const c = cycle(31, 7);
  const first = invoiceFor(c, "2026-01-30");

  it("desloca n faturas atravessando fevereiro e a virada de ano", () => {
    expect(first).toEqual({ closingDate: "2026-01-31", dueDate: "2026-02-07" });
    expect(shiftInvoice(c, first, 0)).toEqual(first);
    expect(shiftInvoice(c, first, 1)).toEqual({ closingDate: "2026-02-28", dueDate: "2026-03-07" });
    expect(shiftInvoice(c, first, 11)).toEqual({
      closingDate: "2026-12-31",
      dueDate: "2027-01-07",
    });
    expect(shiftInvoice(c, first, 12)).toEqual({
      closingDate: "2027-01-31",
      dueDate: "2027-02-07",
    });
    expect(shiftInvoice(c, first, -1)).toEqual({
      closingDate: "2025-12-31",
      dueDate: "2026-01-07",
    });
  });

  it("deslocar n e depois m é o mesmo que deslocar n + m", () => {
    for (const [closingDay, dueDay] of [
      [31, 7],
      [3, 10],
      [25, 5],
      [29, 30],
      [10, 10],
    ] as const) {
      const cc = cycle(closingDay, dueDay);
      for (const start of ["2026-01-15", "2026-02-28", "2027-12-31", "2028-02-29"]) {
        const base = invoiceFor(cc, start);
        for (let n = 0; n <= 14; n++) {
          for (let m = 0; m <= 14; m++) {
            expect(shiftInvoice(cc, shiftInvoice(cc, base, n), m)).toEqual(
              shiftInvoice(cc, base, n + m),
            );
          }
        }
      }
    }
  });

  it("a fatura deslocada é a mesma que uma compra feita meses depois receberia", () => {
    const cc = cycle(3, 10);
    expect(shiftInvoice(cc, invoiceFor(cc, "2026-10-28"), 2)).toEqual(invoiceFor(cc, "2026-12-28"));
  });

  it("recusa n fracionário", () => {
    expect(() => shiftInvoice(c, first, 1.5)).toThrow(RangeError);
  });
});

describe("cycleOn", () => {
  const versions = [
    { validFrom: CYCLE_EPOCH, closingDay: 5, dueDay: 12 },
    { validFrom: "2026-10-10", closingDay: 20, dueDay: 27 },
  ];

  it("usa a versão válida na data da compra", () => {
    expect(cycleOn(versions, "2020-01-01").closingDay).toBe(5);
    expect(cycleOn(versions, "2026-10-09").closingDay).toBe(5);
    expect(cycleOn(versions, "2026-10-10").closingDay).toBe(20);
    expect(cycleOn([...versions].reverse(), "2027-01-01").closingDay).toBe(20);
  });

  it("trocar o fechamento não muda a fatura de uma compra de antes da troca", () => {
    const before = invoiceFor(cycleOn(versions.slice(0, 1), "2026-10-08"), "2026-10-08");
    const after = invoiceFor(cycleOn(versions, "2026-10-08"), "2026-10-08");
    expect(after).toEqual(before);
    expect(after).toEqual({ closingDate: "2026-11-05", dueDate: "2026-11-12" });
    // Purchase after the change uses the new cycle (the edge case in the spec).
    expect(invoiceFor(cycleOn(versions, "2026-10-12"), "2026-10-12")).toEqual({
      closingDate: "2026-10-20",
      dueDate: "2026-10-27",
    });
  });

  it("sem versão válida é erro", () => {
    expect(() =>
      cycleOn([{ validFrom: "2026-01-01", closingDay: 1, dueDay: 8 }], "2025-12-31"),
    ).toThrow(RangeError);
  });
});
