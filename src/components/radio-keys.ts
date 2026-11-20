import type { KeyboardEvent } from "react";

const NEXT = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * The keyboard of a radio group (WAI-ARIA's radio pattern, task 26): only the checked option is in
 * the Tab order, and the arrows (wrapping around), Home and End check and focus another one.
 * Spread `radioProps(option)` on each `role="radio"` button, all inside the same radiogroup.
 */
export function radioKeys<T>(options: readonly T[], value: T, onChange: (option: T) => void) {
  const current = Math.max(0, options.indexOf(value));
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    let index: number | null = null;
    if (NEXT.has(event.key)) index = (current + 1) % options.length;
    else if (PREVIOUS.has(event.key)) index = (current - 1 + options.length) % options.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = options.length - 1;
    if (index === null) return;
    event.preventDefault();
    onChange(options[index]!);
    const group = event.currentTarget.closest('[role="radiogroup"]');
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
  }
  return (option: T) => ({
    tabIndex: options.indexOf(option) === current ? 0 : -1,
    onKeyDown,
  });
}
