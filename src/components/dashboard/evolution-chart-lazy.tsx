"use client";

import dynamic from "next/dynamic";
import { type ComponentProps, useEffect, useRef, useState } from "react";

const placeholder = <div aria-hidden className="h-60 animate-pulse rounded-lg bg-muted/50" />;

const Chart = dynamic(() => import("./evolution-chart"), {
  ssr: false,
  loading: () => placeholder,
});

/**
 * The chart's code (Recharts) loads in the browser only, and only when the chart comes near the
 * screen (task 26): on the phone it's far below the fold, and its download and first render were
 * the home's heaviest work at load (Lighthouse). The table has the same numbers meanwhile.
 */
export function EvolutionChartLazy(props: ComponentProps<typeof Chart>) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = box.current;
    if (!node || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);
  return <div ref={box}>{near ? <Chart {...props} /> : placeholder}</div>;
}
