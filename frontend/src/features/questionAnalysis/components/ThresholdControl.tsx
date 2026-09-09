"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/features/classroom/ui";
import { DEFAULT_THRESHOLD, MAX_THRESHOLD, MIN_THRESHOLD, clampThreshold } from "../format";

const PRESETS = [DEFAULT_THRESHOLD, 40, 50];

/**
 * The cut-off at which a question becomes work.
 *
 * Committed on blur, Enter, or a preset — not on every keystroke. Each change is a fresh
 * request and a fresh cache entry, and typing "40" through an intermediate "4" would fire a
 * report at a 4% threshold that flags almost every question on the paper.
 */
export function ThresholdControl({
  value,
  onChange,
  inputId,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  inputId: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  // The committed value can change from outside this control (a preset, a reset), and the
  // text box has to follow it rather than keep showing what was last typed.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const next = clampThreshold(draft);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <div className={cn("flex items-end gap-2", className)}>
      <div className="w-24">
        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={MIN_THRESHOLD}
          max={MAX_THRESHOLD}
          step={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          className="tabular-nums"
        />
      </div>
      <div className="flex items-center gap-1.5 pb-0.5">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            aria-pressed={value === preset}
            className={cn(
              "rounded-lg border px-2.5 py-1.5 text-xs font-bold tabular-nums transition-colors",
              value === preset
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary",
            )}
          >
            {preset}%
          </button>
        ))}
      </div>
    </div>
  );
}
