"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { Segmented } from "./Choice";
import { inputShell, TextInput, useFieldControl, type TextInputProps } from "./Field";
import { usePresence } from "./presence";

/**
 * Date and time (design handoff v0.3, Controls board): a date button that opens a month — Monday first,
 * today ringed, the chosen day filled, "Today" and the learning center's time zone under it — a 24-hour
 * time field, and a period picker (7 days / 30 days / This month / Dates…). Every day is a date in
 * Asia/Tashkent, as `YYYY-MM-DD`; nothing here converts time zones.
 */
const TZ = "Asia/Tashkent";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Today in Tashkent, "2026-11-11". */
export function tashkentToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

/** "2026-11-12" + n days. */
export function addDaysIso(iso: string, n: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoOf(d);
}

/** The same day n months on, clamped to the month's end (31 Jan + 1 → 28/29 Feb). */
export function addMonthsIso(iso: string, n: number): string {
  const d = parse(iso);
  const day = d.getUTCDate();
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return isoOf(first);
}

/** "12 Nov 2026". */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = parse(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

/** The day kept inside [min, max] (either may be missing), so keyboard focus never lands on a day that can't be picked. */
export function clampIso(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

/** The weeks a month's grid shows, Monday first, whole weeks only: [{ iso, inMonth }…]. */
export function calendarDays(year: number, month0: number): { iso: string; day: number; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month0, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells = Math.ceil((offset + days) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => {
    const d = new Date(Date.UTC(year, month0, 1 - offset + i));
    return { iso: isoOf(d), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month0 };
  });
}

function longLabel(iso: string): string {
  const d = parse(iso);
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(d);
  return `${weekday}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function Calendar({
  value,
  focus,
  setFocus,
  onPick,
  onClose,
  min,
  max,
  today,
}: {
  value: string | null;
  focus: string;
  setFocus: (iso: string) => void;
  onPick: (iso: string) => void;
  onClose: () => void;
  min?: string;
  max?: string;
  today: string;
}) {
  const grid = useRef<HTMLDivElement | null>(null);
  const d = parse(focus);
  const year = d.getUTCFullYear();
  const month0 = d.getUTCMonth();
  const days = calendarDays(year, month0);
  const out = (iso: string) => Boolean((min && iso < min) || (max && iso > max));
  const go = (iso: string) => setFocus(clampIso(iso, min, max));

  useEffect(() => {
    grid.current?.querySelector<HTMLElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dow = (parse(focus).getUTCDay() + 6) % 7;
    const to: Record<string, () => string> = {
      ArrowLeft: () => addDaysIso(focus, -1),
      ArrowRight: () => addDaysIso(focus, 1),
      ArrowUp: () => addDaysIso(focus, -7),
      ArrowDown: () => addDaysIso(focus, 7),
      PageUp: () => addMonthsIso(focus, -1),
      PageDown: () => addMonthsIso(focus, 1),
      Home: () => addDaysIso(focus, -dow),
      End: () => addDaysIso(focus, 6 - dow),
    };
    if (to[e.key]) {
      e.preventDefault();
      go(to[e.key]());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="flex w-[300px] flex-col gap-2 p-1.5">
      <div className="flex items-center justify-between">
        <span className="pl-1.5 text-[15px] font-semibold text-ms-fg" aria-live="polite">
          {MONTHS[month0]} {year}
        </span>
        <span className="flex gap-1">
          <button type="button" aria-label="Previous month" disabled={Boolean(min && min.slice(0, 7) >= focus.slice(0, 7))} onClick={() => go(addMonthsIso(focus, -1))} className="grid size-8 place-items-center rounded-full text-ms-fg-2 hover:bg-ms-surface-2 focus-visible:outline-2 focus-visible:outline-ms-ring disabled:cursor-not-allowed disabled:opacity-40">
            <Icon name="left" size="sm" />
          </button>
          <button type="button" aria-label="Next month" disabled={Boolean(max && max.slice(0, 7) <= focus.slice(0, 7))} onClick={() => go(addMonthsIso(focus, 1))} className="grid size-8 place-items-center rounded-full text-ms-fg-2 hover:bg-ms-surface-2 focus-visible:outline-2 focus-visible:outline-ms-ring disabled:cursor-not-allowed disabled:opacity-40">
            <Icon name="right" size="sm" />
          </button>
        </span>
      </div>
      <div ref={grid} role="grid" aria-label={`${MONTHS[month0]} ${year}`} onKeyDown={onKeyDown} className="flex flex-col gap-0.5">
        <div role="row" className="grid grid-cols-7">
          {WEEK.map((w) => (
            <span key={w} role="columnheader" className="grid h-8 place-items-center text-[12px] font-medium text-ms-fg-3">{w}</span>
          ))}
        </div>
        {Array.from({ length: days.length / 7 }, (_, r) => (
          <div key={r} role="row" className="grid grid-cols-7">
            {days.slice(r * 7, r * 7 + 7).map((c) => {
              const selected = c.iso === value;
              const isToday = c.iso === today;
              const disabled = out(c.iso);
              return (
                <span key={c.iso} role="gridcell" aria-selected={selected} className="grid place-items-center">
                  <button
                    type="button"
                    data-day={c.iso}
                    tabIndex={c.iso === focus ? 0 : -1}
                    aria-label={longLabel(c.iso)}
                    aria-current={isToday ? "date" : undefined}
                    disabled={disabled}
                    onClick={() => onPick(c.iso)}
                    className={cn(
                      "grid size-9 place-items-center rounded-full text-[14px] tabular-nums transition-colors duration-100",
                      "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ms-ring disabled:cursor-not-allowed disabled:opacity-40",
                      selected ? "bg-ms-primary font-semibold text-white" : c.inMonth ? "text-ms-fg hover:bg-ms-surface-2" : "text-ms-fg-disabled hover:bg-ms-surface-2",
                      isToday && !selected && "font-semibold shadow-[inset_0_0_0_1.5px_var(--ms-primary)]",
                    )}
                  >
                    {c.day}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-ms-line pt-2">
        <button type="button" onClick={() => onPick(today)} disabled={out(today)} className="h-8 rounded-full px-3 text-[14px] font-semibold text-ms-primary-text hover:bg-ms-surface-2 focus-visible:outline-2 focus-visible:outline-ms-ring disabled:opacity-40">
          Today
        </button>
        <span className="pr-1.5 text-[12.5px] text-ms-fg-3">{TZ}</span>
      </div>
    </div>
  );
}

export function DateField({
  value,
  onChange,
  min,
  max,
  placeholder = "Pick a date",
  disabled = false,
  "aria-label": ariaLabel,
  today: todayProp,
}: {
  value: string | null;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  /** For tests: the day treated as today. */
  today?: string;
}) {
  const f = useFieldControl();
  const popId = useId();
  const today = todayProp ?? tashkentToday();
  const [open, setOpen] = useState(false);
  const { mounted, closing } = usePresence(open, 120);
  const [focus, setFocus] = useState(clampIso(value ?? today, min, max));
  const button = useRef<HTMLButtonElement | null>(null);
  const pop = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <span className="relative inline-flex w-full min-w-0">
      <button
        ref={button}
        id={f.id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={ariaLabel ? `${ariaLabel}${value ? `, ${formatDay(value)}` : ""}` : undefined}
        aria-describedby={f.describedBy}
        onClick={() => {
          setFocus(clampIso(value ?? today, min, max));
          setOpen((o) => !o);
        }}
        className={cn(inputShell({ invalid: f.invalid, disabled }), "w-full text-left focus-visible:outline-none", open && !f.invalid && "border-ms-primary shadow-[0_0_0_3px_var(--ms-primary-soft-2)]")}
      >
        <Icon name="cal" size="sm" className="shrink-0 text-ms-fg-3" />
        <span className={cn("min-w-0 flex-1 truncate tabular-nums", !value && "text-ms-fg-3")}>{value ? formatDay(value) : placeholder}</span>
      </button>
      {mounted ? (
        <div
          ref={pop}
          id={popId}
          role="dialog"
          aria-label="Choose a date"
          className={cn("absolute left-0 top-full z-50 mt-1.5 origin-top-left rounded-ms-pop border border-ms-border bg-ms-card p-1.5 shadow-ms-2", closing ? "animate-ms-dialog-out" : "animate-ms-dialog-in")}
        >
          <Calendar
            value={value}
            focus={focus}
            setFocus={setFocus}
            today={today}
            min={min}
            max={max}
            onClose={close}
            onPick={(iso) => {
              onChange(iso);
              close();
            }}
          />
        </div>
      ) : null}
    </span>
  );
}

/** "1600" → "16:00", "9:5" → "09:05", "7" → "07:00"; null when it is not a time of day. */
export function normalizeTime(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let h: number;
  let m: number;
  const parts = s.split(/[:.\s]/).filter(Boolean);
  if (parts.length >= 2) {
    h = Number(parts[0]);
    m = Number(parts[1]);
  } else {
    const digits = s.replace(/\D/g, "");
    if (!digits || digits.length > 4) return null;
    if (digits.length <= 2) {
      h = Number(digits);
      m = 0;
    } else {
      h = Number(digits.slice(0, digits.length - 2));
      m = Number(digits.slice(-2));
    }
  }
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

/** A 24-hour time: type "1600" or "16:00"; on leaving the box it reads "16:00", or the field shows an error. */
export function TimeField({
  value,
  onChange,
  onInvalid,
  ...rest
}: Omit<TextInputProps, "value" | "onChange" | "onBlur"> & { value: string; onChange: (hhmm: string) => void; onInvalid?: (raw: string) => void }) {
  const [text, setText] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setText(value);
  }
  return (
    <TextInput
      {...rest}
      icon="clock"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder={rest.placeholder ?? "16:00"}
      value={text}
      className="tabular-nums"
      onChange={(e) => setText(e.target.value.replace(/[^\d:]/g, ""))}
      onBlur={() => {
        if (!text.trim()) return onChange("");
        const t = normalizeTime(text);
        if (t) {
          setText(t);
          onChange(t);
        } else onInvalid?.(text);
      }}
    />
  );
}

export type PeriodKind = "7d" | "30d" | "month" | "dates";
export type Period = { kind: PeriodKind; from: string; to: string };

/** The days a period covers, ending today (Tashkent): 7 days = today and the 6 before. */
export function periodRange(kind: Exclude<PeriodKind, "dates">, today: string): { from: string; to: string } {
  if (kind === "7d") return { from: addDaysIso(today, -6), to: today };
  if (kind === "30d") return { from: addDaysIso(today, -29), to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function PeriodPicker({ value, onChange, today: todayProp }: { value: Period; onChange: (p: Period) => void; today?: string }) {
  const today = todayProp ?? tashkentToday();
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Segmented<PeriodKind>
        label="Period"
        value={value.kind}
        onChange={(kind) => onChange(kind === "dates" ? { ...value, kind } : { kind, ...periodRange(kind, today) })}
        options={[
          { value: "7d", label: "7 days" },
          { value: "30d", label: "30 days" },
          { value: "month", label: "This month" },
          { value: "dates", label: "Dates…" },
        ]}
      />
      {value.kind === "dates" ? (
        <span className="animate-ms-fade-in flex items-center gap-2">
          <span className="w-[150px]">
            <DateField aria-label="From" value={value.from} max={value.to} today={today} onChange={(from) => onChange({ ...value, from })} />
          </span>
          <span className="text-ms-fg-3">–</span>
          <span className="w-[150px]">
            <DateField aria-label="To" value={value.to} min={value.from} today={today} onChange={(to) => onChange({ ...value, to })} />
          </span>
        </span>
      ) : null}
    </div>
  );
}
