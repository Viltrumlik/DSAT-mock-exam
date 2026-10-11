"use client";

/**
 * The classwork XP scale as five buttons — 1, 2, 3, 4, 5 — instead of a number box.
 *
 * The school's scale is a handful of steps (2026-10-11), so a field that accepts any typed
 * number only invites values the server will refuse. Every step is one press, and a
 * teacher marking twenty students in front of a class never has to aim at a text box.
 *
 * `min`/`max` come from the payload (`min_points`/`max_points`) rather than being written
 * here, so the school's scale lives in one place on the server.
 *
 * A legacy award outside the scale (anything given before the scale existed) simply
 * selects nothing: the row's status line already says what the student holds.
 */

import { useRef } from "react";
import { cn } from "@/lib/cn";

export function ClassworkXpPicker({
  value,
  onChange,
  min,
  max,
  label,
  disabled,
}: {
  value: number | null;
  onChange: (next: number) => void;
  min: number;
  max: number;
  /** Read by screen readers as the group's name, e.g. "XP for Aziza Karimova". */
  label: string;
  disabled?: boolean;
}) {
  const steps: number[] = [];
  for (let n = Math.max(1, Math.floor(min)); n <= Math.floor(max); n++) steps.push(n);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  // One tab stop for the whole group (roving tabindex), arrows move between steps — the
  // radio-group pattern, so a keyboard user is not made to tab through five buttons per
  // student on a twenty-student list.
  const focusedIndex = value != null && steps.includes(value) ? steps.indexOf(value) : 0;

  const move = (from: number, delta: number) => {
    const next = Math.min(steps.length - 1, Math.max(0, from + delta));
    refs.current[next]?.focus();
    onChange(steps[next]);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-xl border border-border bg-[var(--background)] p-0.5"
    >
      {steps.map((n, i) => {
        const selected = value === n;
        return (
          <button
            key={n}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${n} XP`}
            tabIndex={i === focusedIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(n)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(
              "h-8 w-8 rounded-lg text-sm font-semibold tabular-nums transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              "disabled:pointer-events-none disabled:opacity-50",
              selected
                ? "bg-primary text-white shadow-sm"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
