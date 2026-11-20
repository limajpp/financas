"use client";

import { Input } from "@/components/ui/input";
import { formatBRLInput, parseBRL } from "@/domain/money";
import { cn } from "@/lib/utils";

/**
 * Text field for an amount in R$. Opens the numeric keypad on the iPhone and tidies the value
 * on blur ("1234,5" → "1.234,50"). Leaves anything it can't read untouched, for the form to flag.
 */
export function MoneyInput({
  value,
  onValueChange,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type" | "inputMode"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <div className={cn("relative", className)}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
      >
        R$
      </span>
      <Input
        {...props}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onBlur={(e) => {
          const cents = parseBRL(value);
          if (cents !== null) onValueChange(formatBRLInput(cents));
          props.onBlur?.(e);
        }}
        className="pl-10 tabular-nums"
      />
    </div>
  );
}
