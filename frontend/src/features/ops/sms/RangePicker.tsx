"use client";

import { useState } from "react";

import { TEXT_BUTTON } from "./panelKit";
import type { StatsRange } from "./smsApi";

/**
 * The days the overview's charts cover: the last 7, 30 or 90, this month, or two dates. It lives
 * in the address as `?range=7d|30d|90d|month|YYYY-MM-DD_YYYY-MM-DD`, so a pasted link shows the
 * same charts; anything else there is the default, the last 30 days.
 */

export type RangePreset = "7d" | "30d" | "90d" | "month";
export type RangeValue = RangePreset | StatsRange;

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "month", label: "This month" },
];
const DAYS: Record<Exclude<RangePreset, "month">, number> = { "7d": 7, "30d": 30, "90d": 90 };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const DEFAULT_RANGE: RangePreset = "30d";

export function parseRange(raw: string | null | undefined): RangeValue {
  if (raw === "7d" || raw === "30d" || raw === "90d" || raw === "month") return raw;
  const [from, to] = (raw ?? "").split("_");
  if (from && to && ISO_DAY.test(from) && ISO_DAY.test(to) && from <= to) return { from, to };
  return DEFAULT_RANGE;
}

export function serializeRange(value: RangeValue): string {
  return typeof value === "string" ? value : `${value.from}_${value.to}`;
}

/** "YYYY-MM-DD" ± days, by the calendar (no time zone can move it). */
function shift(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Inclusive Tashkent days for a range, ending `today`. */
export function rangeDates(value: RangeValue, today: string): StatsRange {
  if (typeof value !== "string") return value;
  if (value === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: shift(today, 1 - DAYS[value]), to: today };
}

const CHIP = "rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors";

export function RangePicker({ value, onChange }: { value: RangeValue; onChange: (value: RangeValue) => void }) {
  const custom = typeof value !== "string";
  const [editing, setEditing] = useState(custom);
  const [from, setFrom] = useState(custom ? value.from : "");
  const [to, setTo] = useState(custom ? value.to : "");

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Range">
      {PRESETS.map((p) => (
        <button
          key={p.value}
          type="button"
          aria-pressed={value === p.value}
          onClick={() => {
            setEditing(false);
            onChange(p.value);
          }}
          className={`${CHIP} ${value === p.value ? "border-[var(--sms-accent)] bg-[var(--sms-accent)] text-white" : "border-border text-muted-foreground hover:text-foreground"}`}
        >
          {p.label}
        </button>
      ))}
      {editing ? (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-[12px]">
          <input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-7 border border-border bg-card px-1.5" />
          <span className="text-muted-foreground">–</span>
          <input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-7 border border-border bg-card px-1.5" />
          <button type="button" className={TEXT_BUTTON} disabled={!from || !to || from > to} onClick={() => onChange({ from, to })}>
            Show
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className={`${CHIP} border-border text-muted-foreground hover:text-foreground`}>
          Dates…
        </button>
      )}
    </div>
  );
}
