import { Check } from "lucide-react";
import { useId } from "react";

import { PALETTE_COLORS, type PaletteColor } from "@/domain/palette";
import { cn } from "@/lib/utils";

/** Tint (background) and ink (icon) for each palette key, readable in light and dark. */
export const COLOR_CLASSES: Record<PaletteColor, { tint: string; ink: string; swatch: string }> = {
  red: { tint: "bg-red-500/15", ink: "text-red-700 dark:text-red-300", swatch: "bg-red-500" },
  orange: {
    tint: "bg-orange-500/15",
    ink: "text-orange-700 dark:text-orange-300",
    swatch: "bg-orange-500",
  },
  amber: {
    tint: "bg-amber-500/15",
    ink: "text-amber-700 dark:text-amber-300",
    swatch: "bg-amber-500",
  },
  lime: { tint: "bg-lime-500/15", ink: "text-lime-700 dark:text-lime-300", swatch: "bg-lime-500" },
  green: {
    tint: "bg-green-500/15",
    ink: "text-green-700 dark:text-green-300",
    swatch: "bg-green-500",
  },
  teal: { tint: "bg-teal-500/15", ink: "text-teal-700 dark:text-teal-300", swatch: "bg-teal-500" },
  sky: { tint: "bg-sky-500/15", ink: "text-sky-700 dark:text-sky-300", swatch: "bg-sky-500" },
  blue: { tint: "bg-blue-500/15", ink: "text-blue-700 dark:text-blue-300", swatch: "bg-blue-500" },
  violet: {
    tint: "bg-violet-500/15",
    ink: "text-violet-700 dark:text-violet-300",
    swatch: "bg-violet-500",
  },
  pink: { tint: "bg-pink-500/15", ink: "text-pink-700 dark:text-pink-300", swatch: "bg-pink-500" },
  slate: {
    tint: "bg-slate-500/15",
    ink: "text-slate-700 dark:text-slate-300",
    swatch: "bg-slate-500",
  },
};

export const COLOR_LABELS: Record<PaletteColor, string> = {
  red: "Vermelho",
  orange: "Laranja",
  amber: "Âmbar",
  lime: "Lima",
  green: "Verde",
  teal: "Verde-azulado",
  sky: "Céu",
  blue: "Azul",
  violet: "Violeta",
  pink: "Rosa",
  slate: "Cinza",
};

/** A radio group of palette swatches. */
export function ColorPicker({
  value,
  onChange,
}: {
  value: PaletteColor;
  onChange: (color: PaletteColor) => void;
}) {
  const labelId = useId();
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium" id={labelId}>
        Cor
      </legend>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {PALETTE_COLORS.map((key) => {
          const selected = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={COLOR_LABELS[key]}
              onClick={() => onChange(key)}
              className={cn(
                "flex size-8 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-popover outline-none focus-visible:ring-3 focus-visible:ring-ring",
                COLOR_CLASSES[key].swatch,
                selected && "ring-2 ring-foreground",
              )}
            >
              {selected && <Check aria-hidden className="size-4" />}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
