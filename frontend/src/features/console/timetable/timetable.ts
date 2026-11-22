import type { BadgeTone, CourseLevel } from "../ui";
import { courseLevelOf } from "../ui";
import { hhmm, isNotMarked, type LessonRow, type LessonsToday } from "../lessonsToday";

/**
 * The timetable's arithmetic (lc-up structure canvas, LessonsTimeline board; lc-up's "Dars jadvali"): rooms are
 * rows, time runs across 13:00–20:00 by the learning center's clock, and each lesson sits across its own hours.
 * Everything here is read from `GET /api/classes/admin/lessons/today/[?date=]`; nothing is invented.
 */

const TZ = "Asia/Tashkent";
/** The board's axis: the centre's afternoon. Widened to the whole hour when a real lesson falls outside it. */
export const AXIS_START = 13 * 60;
export const AXIS_END = 20 * 60;
const DAY_END = 24 * 60;

/** Minutes after midnight, by the learning center's clock. */
export function minutesOfDay(at: string | Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(
    typeof at === "string" ? new Date(at) : at,
  );
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

/** "09:05" from minutes after midnight. */
export function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A lesson's start and end in minutes; an end that reads before its start ran past midnight. Null without a time. */
export function lessonSpan(l: LessonRow): { start: number; end: number } | null {
  if (!l.starts_at || !l.ends_at) return null;
  const start = minutesOfDay(l.starts_at);
  let end = minutesOfDay(l.ends_at);
  if (end <= start) end = DAY_END;
  return { start, end };
}

export type Axis = { start: number; end: number };

/** 13:00–20:00, widened to the whole hour that takes in every timed lesson. */
export function axisOf(lessons: readonly LessonRow[]): Axis {
  let start = AXIS_START;
  let end = AXIS_END;
  for (const l of lessons) {
    const s = lessonSpan(l);
    if (!s) continue;
    start = Math.min(start, Math.floor(s.start / 60) * 60);
    end = Math.max(end, Math.min(DAY_END, Math.ceil(s.end / 60) * 60));
  }
  return { start, end };
}

/** "Room 301" for a bare number, the room as written otherwise, "No room" for a blank. */
export function roomLabel(room: string | null | undefined): string {
  const r = String(room ?? "").trim();
  if (!r) return "No room";
  return /^\d+[a-z]?$/i.test(r) ? `Room ${r}` : r;
}

export type PlacedLesson = {
  lesson: LessonRow;
  start: number;
  end: number;
  /** In % of the axis. */
  left: number;
  width: number;
  /** Two lessons that overlap in one room each get their own lane, so neither hides the other. */
  lane: number;
  level: CourseLevel | null;
};

export type RoomRow = { key: string; label: string; lanes: number; lessons: PlacedLesson[] };

const byRoom = (a: string, b: string) => (!a ? 1 : !b ? -1 : a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));

/**
 * One row per `room_number` (natural order, "No room" last), each with its timed lessons placed on the axis.
 * A lesson with no readable time is not placed — the timetable names it under the grid instead.
 */
export function roomRows(lessons: readonly LessonRow[], axis: Axis = axisOf(lessons)): RoomRow[] {
  const span = axis.end - axis.start;
  const groups = new Map<string, { lesson: LessonRow; start: number; end: number }[]>();
  for (const lesson of lessons) {
    const s = lessonSpan(lesson);
    if (!s) continue;
    const key = String(lesson.classroom.room ?? "").trim();
    const list = groups.get(key) ?? [];
    list.push({ lesson, ...s });
    groups.set(key, list);
  }
  return [...groups.keys()].sort(byRoom).map((key) => {
    const laneEnds: number[] = [];
    const placed = groups
      .get(key)!
      .sort((a, b) => a.start - b.start || a.lesson.classroom.name.localeCompare(b.lesson.classroom.name))
      .map(({ lesson, start, end }) => {
        let lane = laneEnds.findIndex((until) => until <= start);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = end;
        const from = Math.max(start, axis.start);
        const to = Math.min(end, axis.end);
        return {
          lesson,
          start,
          end,
          left: ((from - axis.start) / span) * 100,
          width: (Math.max(to - from, 0) / span) * 100,
          lane,
          level: courseLevelOf(lesson.classroom.level, lesson.classroom.name),
        };
      });
    return { key, label: roomLabel(key), lanes: Math.max(1, laneEnds.length), lessons: placed };
  });
}

export type LessonState = { key: "now" | "not_marked" | "next" | "came" | "done" | "closed" | "unknown"; label: string; tone: BadgeTone };

const came = (l: LessonRow) => l.register.present + l.register.late;

/** A lesson card's badge, from the register's real state: In progress, Not marked, Next — and what an ended one held. */
export function lessonState(l: LessonRow): LessonState {
  if (l.phase === "now") return { key: "now", label: "In progress", tone: "info" };
  if (isNotMarked(l)) return { key: "not_marked", label: "Not marked", tone: "attention" };
  if (l.phase === "upcoming") return { key: "next", label: "Next", tone: "line" };
  if (l.phase === "ended" && l.register.marked > 0) return { key: "came", label: `Came ${came(l)} of ${l.register.roster}`, tone: "positive" };
  // Nobody on the register could be marked (no seats, or everyone frozen): nothing was owed.
  if (l.phase === "ended" && l.register.taken) return { key: "done", label: "Ended", tone: "neutral" };
  if (l.phase === "ended") return { key: "closed", label: "Closed unmarked", tone: "attention" };
  return { key: "unknown", label: "No time set", tone: "line" };
}

/** A lesson on now, in the Today list: who came so far, or that nobody has marked it yet. */
export function nowState(l: LessonRow): { label: string; tone: BadgeTone } {
  if (l.register.marked > 0) return { label: `Came ${came(l)} of ${l.register.roster}`, tone: "positive" };
  if (l.register.roster === 0) return { label: "No students", tone: "neutral" };
  return { label: "Not marked", tone: "attention" };
}

/** Where a lesson card goes: its group, on the attendance tab while its register still waits for marks. */
export function lessonHref(l: LessonRow): string {
  return isNotMarked(l) ? `/ops/classrooms/${l.classroom.id}?tab=attendance` : `/ops/classrooms/${l.classroom.id}`;
}

/** "14:00–16:00" from the earliest start to the latest end; "" when none has a time. */
export function timeSpan(lessons: readonly LessonRow[]): string {
  const timed = lessons.filter((l) => l.starts_at && l.ends_at);
  if (!timed.length) return "";
  const first = timed.reduce((a, b) => (lessonSpan(a)!.start <= lessonSpan(b)!.start ? a : b));
  const last = timed.reduce((a, b) => (lessonSpan(a)!.end >= lessonSpan(b)!.end ? a : b));
  return `${hhmm(first.starts_at)}–${hhmm(last.ends_at)}`;
}

/** The distinct rooms in use, in natural order (blanks left out). */
export function roomsIn(lessons: readonly LessonRow[]): string[] {
  return [...new Set(lessons.map((l) => String(l.classroom.room ?? "").trim()).filter(Boolean))].sort(byRoom);
}

/** "rooms 301–306" for an unbroken run of numbers, "room 301", "rooms 301, 303, 305", or the first three and "+2". */
export function roomsPhrase(rooms: readonly string[]): string {
  if (!rooms.length) return "";
  if (rooms.length === 1) return `room ${rooms[0]}`;
  const nums = rooms.map((r) => (/^\d+$/.test(r) ? Number(r) : NaN));
  if (nums.every((n) => Number.isFinite(n)) && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)) {
    return `rooms ${rooms[0]}–${rooms[rooms.length - 1]}`;
  }
  return rooms.length <= 3 ? `rooms ${rooms.join(", ")}` : `rooms ${rooms.slice(0, 3).join(", ")} +${rooms.length - 3}`;
}

/** "N lessons · M rooms" for a day. */
export function dayCountLine(d: LessonsToday): string {
  const n = d.counts.lessons;
  const m = roomsIn(d.lessons).length;
  return `${n} ${n === 1 ? "lesson" : "lessons"} · ${m} ${m === 1 ? "room" : "rooms"}`;
}

// ─── Room usage ──────────────────────────────────────────────────────────────

export type RoomUse = { key: string; label: string; lessons: number; minutes: number; share: number };

/** Per room: its lessons, the minutes it is busy (overlaps counted once) and that as a share of the axis. */
export function roomUsage(rows: readonly RoomRow[], axis: Axis): RoomUse[] {
  const span = axis.end - axis.start;
  return rows.map((r) => {
    let minutes = 0;
    let until = -1;
    for (const p of [...r.lessons].sort((a, b) => a.start - b.start)) {
      const from = Math.max(p.start, until);
      if (p.end > from) minutes += p.end - from;
      until = Math.max(until, p.end);
    }
    return { key: r.key, label: r.label, lessons: r.lessons.length, minutes, share: span > 0 ? minutes / span : 0 };
  });
}

/** "3 h", "1 h 30 min", "45 min". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ─── Days ────────────────────────────────────────────────────────────────────

export type Parity = "odd" | "even";
export type DayTabId = "today" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type DayTab = { id: DayTabId; short: string; date: string; long: string; parity: Parity | null };

const IDS: DayTabId[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const utc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/** Monday 0 … Sunday 6. */
export function weekdayOf(iso: string): number {
  return (utc(iso).getUTCDay() + 6) % 7;
}

/** Classes meet ODD (Mon / Wed / Fri) or EVEN (Tue / Thu / Sat); Sunday is neither. */
export function parityOf(weekday: number): Parity | null {
  if (weekday === 6) return null;
  return weekday % 2 === 0 ? "odd" : "even";
}

/** "Monday, 23 November". */
export function longDay(iso: string): string {
  const d = utc(iso);
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(d);
  return `${weekday}, ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(d)}`;
}

/**
 * Today, then Mon … Sun: each weekday is its NEXT lesson day on or after today (today's own weekday is today), so
 * the tabs read as the coming week's timetable and only today has registers to report.
 */
export function dayTabs(today: string): DayTab[] {
  const base = utc(today);
  const at = weekdayOf(today);
  const tab = (id: DayTabId, short: string, date: string): DayTab => ({ id, short, date, long: longDay(date), parity: parityOf(weekdayOf(date)) });
  return [
    tab("today", "Today", today),
    ...IDS.map((id, w) => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + ((w - at + 7) % 7));
      return tab(id, SHORT[w], isoOf(d));
    }),
  ];
}

/** The soonest day of a parity: today when it is one, else the next such weekday. */
export function soonestOf(tabs: readonly DayTab[], parity: Parity): DayTabId {
  const hit = tabs.filter((t) => t.parity === parity).sort((a, b) => a.date.localeCompare(b.date) || (a.id === "today" ? -1 : 1))[0];
  return hit?.id ?? "today";
}

// ─── Export ──────────────────────────────────────────────────────────────────

/** The day as rows for a spreadsheet: a header, then each lesson by room and start (untimed ones last). */
export function exportRows(d: LessonsToday): (string | number)[][] {
  const head = ["Date", "Room", "Start", "End", "Group", "Teacher", "Students", "State"];
  const rows = [...d.lessons]
    .sort((a, b) => {
      const ra = String(a.classroom.room ?? "").trim();
      const rb = String(b.classroom.room ?? "").trim();
      return byRoom(ra, rb) || (lessonSpan(a)?.start ?? DAY_END) - (lessonSpan(b)?.start ?? DAY_END) || a.classroom.name.localeCompare(b.classroom.name);
    })
    .map((l) => [
      d.date,
      roomLabel(l.classroom.room),
      hhmm(l.starts_at),
      hhmm(l.ends_at),
      l.classroom.name,
      l.teacher?.name ?? "No teacher",
      l.register.roster,
      lessonState(l).label,
    ]);
  return [head, ...rows];
}
