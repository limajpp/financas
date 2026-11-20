"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatBRL } from "@/domain/money";

import type { EvolutionPoint } from "./evolution-data";

/** The series, in the dataviz palette's fixed order (globals.css): income, expense, leftover. */
export const SERIES = [
  { key: "income", label: "Receitas", color: "var(--chart-income)" },
  { key: "expense", label: "Despesas", color: "var(--chart-expense)" },
  { key: "leftover", label: "Sobra", color: "var(--chart-leftover)" },
] as const;

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Income and expense per month as grouped columns, the leftover as a line over them, on one axis
 * (all in R$). A month before the history draws nothing; the first, partial one, lighter.
 */
export default function EvolutionChart({ points }: { points: EvolutionPoint[] }) {
  return (
    <ComposedChart
      responsive
      // Hidden from assistive technology, with the table as its equivalent (task 26): Recharts'
      // keyboard layer would put a focusable element inside that hidden area.
      accessibilityLayer={false}
      data={points}
      margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
      barGap={2}
      style={{ width: "100%", height: 240 }}
    >
      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
      <XAxis
        dataKey="month"
        tickLine={false}
        axisLine={{ stroke: "var(--chart-grid)" }}
        interval={0}
        height={36}
        tick={(props) => <MonthTick {...props} points={points} />}
      />
      <YAxis
        width={44}
        tickLine={false}
        axisLine={false}
        tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
        tickFormatter={(cents: number) => compact.format(cents / 100)}
      />
      <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />
      <Tooltip
        cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
        content={({ active, payload }) => (
          <EvolutionTooltip active={active} point={payload?.[0]?.payload as EvolutionPoint} />
        )}
      />
      {SERIES.slice(0, 2).map((s) => (
        <Bar
          key={s.key}
          dataKey={s.key}
          name={s.label}
          fill={s.color}
          maxBarSize={20}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        >
          {points.map((p) => (
            <Cell key={p.month} fillOpacity={p.partial ? 0.45 : 1} />
          ))}
        </Bar>
      ))}
      <Line
        dataKey="leftover"
        name="Sobra"
        stroke={SERIES[2].color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        dot={{ r: 4, fill: SERIES[2].color, stroke: "var(--background)", strokeWidth: 2 }}
        activeDot={{ r: 5, stroke: "var(--background)", strokeWidth: 2 }}
        connectNulls={false}
        isAnimationActive={false}
      />
    </ComposedChart>
  );
}

type TickProps = { x?: number | string; y?: number | string; payload?: { value: string } };

/** "jul" and, under it, "parcial" or "sem dados"; the chosen month in bold. */
function MonthTick({ x, y, payload, points }: TickProps & { points: EvolutionPoint[] }) {
  const point = points.find((p) => p.month === payload?.value);
  if (!point) return null;
  return (
    <text
      x={Number(x)}
      y={Number(y) + 12}
      textAnchor="middle"
      fontSize={11}
      fill={point.selected ? "var(--foreground)" : "var(--muted-foreground)"}
      fontWeight={point.selected ? 600 : 400}
    >
      <tspan x={Number(x)}>{point.short}</tspan>
      {point.note && (
        <tspan x={Number(x)} dy={13} fontSize={10}>
          {point.note}
        </tspan>
      )}
    </text>
  );
}

/** Every series of the month: the value leads, the name follows (dataviz). */
function EvolutionTooltip({ active, point }: { active?: boolean; point?: EvolutionPoint }) {
  if (!active || !point) return null;
  return (
    <div className="grid gap-1 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <span className="font-medium first-letter:uppercase">
        {point.long}
        {point.note && ` (${point.note})`}
      </span>
      {point.income === null ? (
        <span className="text-muted-foreground">Antes de usar o app</span>
      ) : (
        SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className={s.key === "leftover" ? "h-0.5 w-3 rounded-full" : "size-2 rounded-sm"}
              style={{ background: s.color }}
            />
            <span className="font-semibold tabular-nums">{formatBRL(point[s.key]!)}</span>
            <span className="text-muted-foreground">{s.label}</span>
          </span>
        ))
      )}
    </div>
  );
}
