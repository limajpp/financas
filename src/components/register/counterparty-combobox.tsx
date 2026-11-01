"use client";

import { useId, useMemo, useRef, useState } from "react";

import { CategoryIcon } from "@/components/categories/category-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type CounterpartyMatch, searchCounterparties } from "@/domain/counterparty-search";
import type { EntryType } from "@/domain/transactions";
import { cn } from "@/lib/utils";

import type { CounterpartyOption, RegisterCategory } from "./types";

/** How far (px) a finger may move and still count as a tap. */
const TAP_SLOP = 10;

function matchHint(match: CounterpartyMatch) {
  if (match.field === "alias") return `no extrato: ${match.text}`;
  if (match.field === "document") return `CPF/CNPJ: ${match.text}`;
  return null;
}

/**
 * "O que foi?" with the memory's suggestions (ARIA combobox). Typing filters on the device;
 * a tap, or ↑/↓ and Enter, picks one. Return without a highlighted option closes the keyboard.
 */
export function CounterpartyCombobox({
  value,
  onChange,
  onPick,
  options,
  type,
  categories,
  placeholder,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (option: CounterpartyOption) => void;
  options: CounterpartyOption[];
  type: EntryType;
  categories: ReadonlyMap<string, RegisterCategory>;
  placeholder: string;
  maxLength: number;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  // Where a touch on an option started: a drag (scrolling) isn't a tap.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const results = useMemo(() => searchCounterparties(value, options), [value, options]);
  const expanded = open && results.length > 0;

  function pick(option: CounterpartyOption, input: HTMLInputElement | null) {
    onPick(option);
    setOpen(false);
    setActive(-1);
    // Closes the iPhone keyboard, so the categories show.
    input?.blur();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (event.key === "Escape") {
      if (expanded) event.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if (event.key === "Enter") {
      // Enter that confirms an IME composition (accents, other alphabets) isn't ours.
      if (event.nativeEvent.isComposing) return;
      // Never submits the form: picks the highlighted option or closes the keyboard.
      event.preventDefault();
      const chosen = expanded && active >= 0 ? results[active] : undefined;
      if (chosen) pick(chosen.counterparty, event.currentTarget);
      else event.currentTarget.blur();
    }
  }

  return (
    <div className="relative">
      <Label htmlFor={id} className="sr-only">
        O que foi?
      </Label>
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        maxLength={maxLength}
        autoComplete="off"
        enterKeyHint="done"
        placeholder={placeholder}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Sugestões"
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-20 mt-1 grid overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md"
      >
        {results.map(({ counterparty, match }, index) => {
          const categoryId = counterparty.suggestions[type].categoryId;
          const category = categoryId ? categories.get(categoryId) : undefined;
          const hint = matchHint(match);
          return (
            <li
              key={counterparty.id}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === active}
              // Mouse: keep the focus in the field until the click lands (a blur closes the list).
              onMouseDown={(e) => e.preventDefault()}
              // Touch: pick on touchend and cancel the emulated mouse events, so the field's
              // blur doesn't close the list first and no ghost click hits the category below.
              onTouchStart={(e) => {
                const touch = e.touches[0];
                touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
              }}
              onTouchEnd={(e) => {
                const start = touchStart.current;
                const touch = e.changedTouches[0];
                touchStart.current = null;
                const moved =
                  !start ||
                  !touch ||
                  Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_SLOP;
                // Scrolling already started (non-cancelable) or the finger moved: not a pick.
                if (moved || !e.cancelable) return;
                e.preventDefault();
                pick(counterparty, inputRef.current);
              }}
              onPointerEnter={() => setActive(index)}
              // Mouse and screen readers (VoiceOver activates with a click).
              onClick={() => pick(counterparty, inputRef.current)}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5",
                index === active && "bg-muted",
              )}
            >
              {category ? (
                <CategoryIcon icon={category.icon} color={category.color} className="size-7" />
              ) : (
                <span aria-hidden className="size-7 shrink-0" />
              )}
              <span className="grid min-w-0">
                <span className="truncate">{counterparty.name}</span>
                {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
