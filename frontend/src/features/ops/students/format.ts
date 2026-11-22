import { courseLevelOf, courseName, type CourseLevel } from "@/features/console/ui";

/**
 * Words the Students and Groups lists share (canvas boards, 22 Nov 2026): a group named the way lc-up names it,
 * its lesson days, and how far a course has come.
 */

const SUBJECT_WORD: Record<string, string> = { MATH: "Math", ENGLISH: "English" };

export function subjectWord(subject: string | null | undefined): string {
  const s = String(subject ?? "").toUpperCase();
  return SUBJECT_WORD[s] ?? (s ? s.charAt(0) + s.slice(1).toLowerCase() : "");
}

/**
 * A group as lc-up names it: "Junior G21 · Math · Bekzod". A class paired with lc-up already carries lc-up's
 * "Junior G21 | Math | Bekzod" (its teacher's name is lc-up's); another class adds its subject, unless the name
 * says it, and its teacher's surname.
 */
export function groupLabel(name: string, subject?: string | null, teacherSurname?: string | null): string {
  const parts = name.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) return parts.join(" · ");
  const word = subjectWord(subject);
  const named = word && name.toLowerCase().includes(word.toLowerCase());
  return [name.trim(), named ? "" : word, (teacherSurname ?? "").trim()].filter(Boolean).join(" · ");
}

/** The level a group's tag is coloured by: its own level, else the first word of its name. */
export function groupLevel(level: string | null | undefined, name: string): CourseLevel | null {
  return courseLevelOf(level, name);
}

/** "Junior Math", or "" when the group's level is unknown. */
export function courseOf(level: string | null | undefined, name: string, subject: string | null | undefined): string {
  const l = groupLevel(level, name);
  return l ? courseName(l, subject) : "";
}

/** lc-up's days: ODD = Monday, Wednesday, Friday; EVEN = Tuesday, Thursday, Saturday. */
export const LESSON_DAYS: Record<string, readonly string[]> = {
  ODD: ["Mon", "Wed", "Fri"],
  EVEN: ["Tue", "Thu", "Sat"],
};

export function daysText(lessonDays: string): string {
  return (LESSON_DAYS[lessonDays] ?? []).join(" ");
}

/** "14:00–16:00" from the start and the lesson's hours; the start alone when the length is unknown. */
export function timeRange(start: string | null | undefined, hours: number | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(start ?? "").trim());
  if (!m) return "";
  const from = `${m[1].padStart(2, "0")}:${m[2]}`;
  if (!hours || hours <= 0) return from;
  const end = (Number(m[1]) * 60 + Number(m[2]) + hours * 60) % (24 * 60);
  return `${from}–${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "6 Nov 2026" from "YYYY-MM-DD" (the day as written, no time zone in between); "" for none. */
export function shortDay(day: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day ?? ""));
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : "";
}

/** "500 000 so'm a month". */
export function priceText(price: number | null | undefined): string {
  if (price === null || price === undefined) return "";
  return `${Math.round(price).toLocaleString("en-US").replace(/,/g, " ")} so’m a month`;
}

export type LessonsTone = "early" | "half" | "late" | "past";

/**
 * How far a course has come, in lc-up's colours: under half blue, from half amber, from three quarters red, past
 * the plan near-black. `flag` is "Past plan by N", "Last lesson" or "Ends in N" (two left or fewer).
 */
export function lessonsProgress(done: number, total: number): { percent: number; tone: LessonsTone; flag: string } {
  const percent = total > 0 ? (done / total) * 100 : 0;
  const tone: LessonsTone = percent > 100 ? "past" : percent >= 75 ? "late" : percent >= 50 ? "half" : "early";
  const left = total - done;
  const flag = done > total ? `Past plan by ${done - total}` : left === 0 ? "Last lesson" : left <= 2 ? `Ends in ${left}` : "";
  return { percent, tone, flag };
}

/** "50%", "85.7%", "126.9%" — one decimal only when it is not whole, as lc-up writes it. */
export function percentText(percent: number): string {
  const r = Math.round(percent * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}%`;
}
