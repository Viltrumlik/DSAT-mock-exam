"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

const SECTION_MIN = 200;
const SECTION_MAX = 800;
const SECTION_STEP = 10;

type GoalScoreModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMath: number;
  initialEnglish: number;
  saving?: boolean;
  onSubmit: (math: number, english: number) => void | Promise<void>;
};

export function GoalScoreModal({
  open,
  onOpenChange,
  initialMath,
  initialEnglish,
  saving = false,
  onSubmit,
}: GoalScoreModalProps) {
  const titleId = useId();
  const [math, setMath] = useState(initialMath);
  const [english, setEnglish] = useState(initialEnglish);

  useEffect(() => {
    if (!open) return;
    setMath(clampSection(initialMath));
    setEnglish(clampSection(initialEnglish));
  }, [open, initialMath, initialEnglish]);

  const overall = math + english;

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative z-10 w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-2xl",
          "dark:border-white/10 dark:bg-[color-mix(in_srgb,var(--card)_92%,#0a0a0a)]",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-extrabold tracking-tight text-foreground">
            My Goal Score
          </h2>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 flex justify-center">
          <div
            className={cn(
              "flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-primary/40",
              "bg-gradient-to-br from-primary/20 to-primary/10 text-2xl font-black tracking-tight text-foreground",
              "shadow-[0_12px_28px_-8px_color-mix(in_srgb,var(--primary)_35%,transparent)]",
            )}
          >
            SAT
          </div>
        </div>

        <p className="mt-4 text-center text-sm font-semibold text-muted-foreground">
          Overall target:{" "}
          <span className="tabular-nums text-foreground">{overall}</span>
          <span className="text-xs font-bold text-muted-foreground"> / 1600</span>
        </p>

        <div className="mt-6 space-y-6">
          <SectionSlider
            label="Math score"
            value={math}
            onChange={setMath}
            disabled={saving}
          />
          <SectionSlider
            label="English score"
            value={english}
            onChange={setEnglish}
            disabled={saving}
          />
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => void onSubmit(math, english)}
          className={cn(
            "mt-8 w-full rounded-2xl py-3.5 text-sm font-bold text-primary-foreground",
            "bg-[color-mix(in_srgb,var(--primary)_88%,#0f172a)] shadow-md",
            "ring-1 ring-primary/30 transition-opacity hover:opacity-95",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {saving ? "Saving…" : "Submit"}
        </button>
      </div>
    </div>
  );
}

function clampSection(n: number) {
  const s = SECTION_STEP;
  const rounded = Math.round(n / s) * s;
  return Math.min(SECTION_MAX, Math.max(SECTION_MIN, rounded));
}

function SectionSlider({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-foreground">
          {label}: <span className="tabular-nums">{value}</span>
        </span>
      </div>
      <input
        type="range"
        min={SECTION_MIN}
        max={SECTION_MAX}
        step={SECTION_STEP}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clampSection(Number(e.target.value)))}
        className={cn(
          "h-2 w-full cursor-pointer appearance-none rounded-full bg-primary/25",
          "[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none",
          "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-md",
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        style={{ accentColor: "var(--primary)" }}
      />
    </div>
  );
}

export function initialSectionsFromTarget(target: number | null | undefined): { math: number; english: number } {
  const def = { math: 400, english: 400 };
  if (target == null || target < 400 || target > 1600) return def;
  const t = Math.min(1600, Math.max(400, Math.round(target / SECTION_STEP) * SECTION_STEP));
  let m = clampSection(Math.round(t / 2));
  let e = clampSection(t - m);
  if (e < SECTION_MIN) {
    e = SECTION_MIN;
    m = clampSection(t - e);
  }
  if (e > SECTION_MAX) {
    e = SECTION_MAX;
    m = clampSection(t - e);
  }
  if (m < SECTION_MIN || m > SECTION_MAX) return def;
  return { math: m, english: e };
}
