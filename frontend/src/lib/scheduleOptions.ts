/**
 * Shared date/time option builders for curated scheduling dropdowns (used by the
 * midterm assignment + schedule pickers). Mirrors the homework picker's "next 7
 * days" date choices, with midterm-specific time slots from 08:00–18:00 in
 * 15-minute steps (8:00, 8:15, 8:30, …).
 */

type Opt = { value: string; label: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** 12-hour label for an HH:MM 24h time, e.g. (8,15) → "8:15 AM". */
export function time12(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad(minute)} ${period}`;
}

/** The next `n` calendar days as YYYY-MM-DD options with weekday labels. */
export function nextNDays(n = 7): Opt[] {
  const out: Opt[] = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const label =
      i === 0
        ? `Today · ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`
        : i === 1
          ? `Tomorrow · ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`
          : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    out.push({ value, label });
  }
  return out;
}

/** Time slots from `startHour`:00 to `endHour`:00 inclusive, every `stepMin` minutes. */
export function timeSlots(startHour = 8, endHour = 18, stepMin = 15): Opt[] {
  const out: Opt[] = [];
  for (let h = startHour; h <= endHour; h++) {
    for (let m = 0; m < 60; m += stepMin) {
      if (h === endHour && m > 0) break; // stop exactly at endHour:00
      out.push({ value: `${pad(h)}:${pad(m)}`, label: time12(h, m) });
    }
  }
  return out;
}

/** Combine a YYYY-MM-DD date + HH:MM time (local) into an ISO string, or null. */
export function combineLocalDateTimeIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Split an ISO string back into { date: YYYY-MM-DD, time: HH:MM } (local). */
export function isoToLocalParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
