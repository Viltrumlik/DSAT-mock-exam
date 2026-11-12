/**
 * Shared date/time option builders for curated scheduling dropdowns (used by the
 * midterm assignment + schedule pickers). Mirrors the homework picker's "next 7
 * days" date choices, with midterm-specific time slots from 08:00–18:00 in
 * 15-minute steps (8:00, 8:15, 8:30, …).
 *
 * The days and the slots are Tashkent's — the hours the class sits in the room — so
 * "Today" is the school's today and a 16:00 slot is 16:00 in Tashkent on any device.
 */

import { fromLocalInput } from "@/lib/datetimeLocal";
import { SCHOOL_TIME_ZONE, schoolDateKey, schoolMidday } from "@/lib/schoolTime";

type Opt = { value: string; label: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** 12-hour label for an HH:MM 24h time, e.g. (8,15) → "8:15 AM". */
export function time12(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad(minute)} ${period}`;
}

const DAY_MS = 86_400_000;

/** The next `n` school days (from Tashkent's today) as YYYY-MM-DD options with weekday labels. */
export function nextNDays(n = 7): Opt[] {
  const out: Opt[] = [];
  const todayMidday = schoolMidday(schoolDateKey(new Date())).getTime();
  for (let i = 0; i < n; i++) {
    // Midday on a school date stays on that date in Tashkent, so whole days can be added to it.
    const day = new Date(todayMidday + i * DAY_MS);
    const value = schoolDateKey(day);
    const date = day.toLocaleDateString("en-US", {
      timeZone: SCHOOL_TIME_ZONE, weekday: "short", month: "short", day: "numeric",
    });
    const label = i === 0 ? `Today · ${date}` : i === 1 ? `Tomorrow · ${date}` : date;
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

/** Combine a YYYY-MM-DD date + HH:MM time, both Tashkent's, into an ISO string, or null. */
export function combineLocalDateTimeIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  return fromLocalInput(`${date}T${time}`);
}
