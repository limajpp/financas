"use client";

import { Delete } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { KeypadKey } from "@/domain/amount-keypad";

const ROWS: KeypadKey[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["00", "0", "backspace"],
];

/** The on-screen number pad. Always open: Safari won't open the system keyboard by itself. */
export function Keypad({ onKey }: { onKey: (key: KeypadKey) => void }) {
  return (
    <div role="group" aria-label="Teclado numérico" className="grid grid-cols-3 gap-1.5">
      {ROWS.flat().map((key) => (
        <Button
          key={key}
          type="button"
          variant="secondary"
          className="h-11 text-xl font-medium tabular-nums [@media(max-height:700px)]:h-10"
          aria-label={key === "backspace" ? "Apagar" : undefined}
          onClick={() => onKey(key)}
        >
          {key === "backspace" ? <Delete aria-hidden className="size-5" /> : key}
        </Button>
      ))}
    </div>
  );
}
