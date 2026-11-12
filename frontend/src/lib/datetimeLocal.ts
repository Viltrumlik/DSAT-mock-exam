import { SCHOOL_TIME_ZONE } from "@/lib/schoolTime";

/**
 * `<input type="datetime-local">` holds a bare wall-clock reading, "2026-11-09T16:00", with no
 * zone; the API speaks ISO with one. These two helpers are where the gap is crossed, and the
 * reading on the form side is always Tashkent's: a staffer scheduling "16:00" means 16:00 at the
 * centre, whatever clock their laptop keeps.
 *
 * Both used to use the device's clock (`getHours()`, `new Date(value)`). On a laptop three hours
 * behind Tashkent that showed a 16:00 event as 13:00 in its edit form — beside a list that, since
 * #364, says 16:00 — and saved a typed 16:00 as 19:00 Tashkent.
 */

const WALL_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: SCHOOL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Tashkent's wall-clock reading of a moment, as `datetime-local` numbers. */
function schoolWallClock(at: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts: Record<string, string> = {};
  for (const p of WALL_CLOCK.formatToParts(at)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** How far Tashkent's clock runs ahead of UTC at a moment, in ms (UTC+5 → 18 000 000). */
function schoolOffsetMs(at: number): number {
  const w = schoolWallClock(new Date(at));
  const wholeMinute = Math.floor(at / 60_000) * 60_000;
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - wholeMinute;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The `datetime-local` value showing `iso` on Tashkent's clock; "" for none. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const w = schoolWallClock(d);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** `YYYY-MM-DDTHH:mm`, with seconds when the input's `step` asks for them. */
const LOCAL_VALUE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

/** The moment a `datetime-local` value names when read on Tashkent's clock; null for none. */
export function fromLocalInput(value: string): string | null {
  const m = LOCAL_VALUE.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map((s) => Number(s ?? 0));
  const ms = Number((m[7] ?? "").padEnd(3, "0"));
  const wall = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // Date.UTC rolls 30 February over into March; a value that rolled is not a time.
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day ||
    check.getUTCHours() !== hour || check.getUTCMinutes() !== minute
  ) {
    return null;
  }
  // The offset at the guess, then at the answer: Tashkent keeps one offset all year, but this
  // stays right should the school's zone ever be one that moves.
  const guess = wall - schoolOffsetMs(wall);
  return new Date(wall - schoolOffsetMs(guess)).toISOString();
}
