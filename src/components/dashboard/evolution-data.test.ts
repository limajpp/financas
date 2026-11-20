import { describe, expect, it } from "vitest";

import type { EvolutionMonth } from "@/domain/metrics";

import { evolutionPoints } from "./evolution-data";

const month = (m: string, extra: Partial<EvolutionMonth> = {}): EvolutionMonth => ({
  month: m,
  incomeCents: 800_000,
  expenseCents: 300_000,
  leftoverCents: 500_000,
  savingsRate: 0.625,
  fixedCents: 250_000,
  variableCents: 50_000,
  beforeHistory: false,
  ...extra,
});

describe("evolutionPoints", () => {
  it("antes do histórico não é zero, o primeiro mês é parcial e o escolhido vem marcado", () => {
    const points = evolutionPoints(
      [
        month("2026-06", {
          beforeHistory: true,
          incomeCents: 0,
          expenseCents: 0,
          leftoverCents: 0,
        }),
        month("2026-07"),
        month("2026-08"),
      ],
      "2026-08",
      "2026-07-20",
    );
    expect(points.map((p) => [p.short, p.note, p.selected, p.income])).toEqual([
      ["jun", "sem dados", false, null],
      ["jul", "parcial", false, 800_000],
      ["ago", null, true, 800_000],
    ]);
    expect(points[1]).toMatchObject({ long: "julho de 2026", partial: true, leftover: 500_000 });
  });
});
