import { SCHOOL_TIME_ZONE } from "@/lib/schoolTime";

/**
 * The words the student profile and the group page share for a group's facts (lc-up structure, 22 Nov 2026):
 * its days ("Mon Wed Fri"), a calendar day as lc-up writes it ("23 Oct 2026"), and a weekday's name.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** `Classroom.lesson_days`: odd days are Monday, Wednesday, Friday; even days Tuesday, Thursday, Saturday. */
export const DAYS_TEXT: Record<string, string> = { ODD: "Mon Wed Fri", EVEN: "Tue Thu Sat" };

export function daysText(days: string | null | undefined): string {
  return days ? (DAYS_TEXT[days] ?? days) : "";
}

/** "Mon Wed Fri · 16:00–18:00", whichever half is known; "" when neither is. */
export function scheduleLine(days: string | null | undefined, time: string | null | undefined): string {
  return [daysText(days), (time ?? "").replace("-", "–")].filter(Boolean).join(" · ");
}

/**
 * "23 Oct 2026". A bare day ("YYYY-MM-DD") is read as it is — `new Date` would take it as UTC midnight, the day
 * before west of Greenwich; a moment is read on the school's clock. "—" for nothing.
 */
export function dayText(value: string | null | undefined): string {
  if (!value) return "—";
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (bare) return `${Number(bare[3])} ${MONTHS[Number(bare[2]) - 1]} ${bare[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  // The school's calendar day, then the same words as a bare day ("Sept" is what en-GB's short month says now).
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return dayText(local);
}

/** "2 Nov" — a register column's head. */
export function shortDay(iso: string): string {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return bare ? `${Number(bare[3])} ${MONTHS[Number(bare[2]) - 1]}` : iso;
}

/** "Monday" for "2026-11-23" (a bare day, read as it is). */
export function weekdayOf(iso: string): string {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!bare) return "";
  return WEEKDAYS[new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])).getDay()];
}

/** "November 2026" → the month segment's short name, "Nov". */
export function monthShort(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? MONTHS[Number(m[2]) - 1] : month;
}

/** A teacher's surname for a group's title ("Foundation G13 · Math · Aliyev"): the last word of the display name. */
export function teacherSurname(name: string | null | undefined): string {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.length ? words[words.length - 1] : "";
}

/** "Foundation G13 · Math · Aliyev": the group's name and its teacher's surname, as lc-up titles a group. */
export function groupTitle(name: string, teacher: string | null | undefined): string {
  const surname = teacherSurname(teacher);
  return surname ? `${name} · ${surname}` : name;
}
