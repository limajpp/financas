"use client";

import dynamic from "next/dynamic";

/**
 * The chart's code (Recharts) loads after the rest of the page, in the browser only: it never
 * holds the home's first paint on the phone (task 25).
 */
export const EvolutionChartLazy = dynamic(() => import("./evolution-chart"), {
  ssr: false,
  loading: () => <div aria-hidden className="h-60 animate-pulse rounded-lg bg-muted/50" />,
});
