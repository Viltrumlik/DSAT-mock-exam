/**
 * The school's own clock.
 *
 * A support hour, a session, a deadline at the centre — each is an hour in Tashkent. Rendering
 * one in the reader's device timezone (`toLocaleString(undefined, …)` with no `timeZone`) makes
 * the same hour read differently on two screens: on 2026-11-09 a student whose laptop sat three
 * hours behind Tashkent booked the 16:00 hour believing it was 13:00, and the support teacher,
 * on a Tashkent clock, found another student in that seat.
 *
 * Pass `timeZone: SCHOOL_TIME_ZONE` to every `toLocale*String` call that shows such an hour,
 * and use the helpers below for "which day is it" questions, which `setHours(0, 0, 0, 0)`
 * answers in the device's zone. The locale stays the reader's — only the clock is pinned.
 */
export const SCHOOL_TIME_ZONE = "Asia/Tashkent";

const DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: SCHOOL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The school's calendar date of a moment, as `"2026-11-09"`. */
export function schoolDateKey(at: Date | number): string {
  const parts: Record<string, string> = {};
  for (const p of DATE_PARTS.formatToParts(at)) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date the backend names (`"2026-11-09"` — already a school date) or a full moment, as the
 * school's calendar date. `null` when it is neither.
 */
export function toSchoolDateKey(iso: string): string | null {
  if (DATE_ONLY.test(iso)) return iso;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : schoolDateKey(at);
}

/** Whole days from one school date to another: `"2026-11-09"` → `"2026-11-10"` is 1. */
export function schoolDaysBetween(fromKey: string, toKey: string): number {
  return Math.round(
    (Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000,
  );
}

/** Midday on a school date — a moment that falls on that date when formatted in the school's zone. */
export function schoolMidday(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}
