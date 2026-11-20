"use client";

import { useRouter } from "next/navigation";
import { useId } from "react";

import { NativeSelect } from "@/components/native-select";
import { Label } from "@/components/ui/label";
import { PERIODS, PERIOD_LABELS, type Period } from "@/domain/counterparties";

/** The period of the counterparties screens; it lives in the URL (`?periodo=`). */
export function PeriodSelect({ period, path }: { period: Period; path: string }) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-muted-foreground">
        Período
      </Label>
      <NativeSelect
        id={id}
        value={period}
        className="w-auto"
        onChange={(e) => router.push(`${path}?periodo=${e.target.value}`)}
      >
        {PERIODS.map((p) => (
          <option key={p} value={p}>
            {PERIOD_LABELS[p]}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
