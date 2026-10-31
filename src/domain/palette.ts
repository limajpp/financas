/** Palette keys shared by categories and accounts. The UI turns each key into theme colors. */
export const PALETTE_COLORS = [
  "red",
  "orange",
  "amber",
  "lime",
  "green",
  "teal",
  "sky",
  "blue",
  "violet",
  "pink",
  "slate",
] as const;
export type PaletteColor = (typeof PALETTE_COLORS)[number];
