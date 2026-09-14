/**
 * What the profile works out for itself — no fetching and no React, so every rule here is
 * tested on its own (`__tests__/profileModel.test.ts`).
 */

/* ── Devices ─────────────────────────────────────────────────────────────────────────── */

export type DeviceKind = "phone" | "tablet" | "computer" | "app";

/**
 * "Chrome on Windows" out of `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 …`.
 *
 * The device list used to print the raw user-agent string, which is a sentence nobody can read
 * and every row began the same way. Order matters in both lookups: Edge, Opera and Samsung
 * Internet all also say "Chrome", and Chrome also says "Safari".
 */
export function describeDevice(userAgent: string | null | undefined): { label: string; kind: DeviceKind } {
  const ua = userAgent ?? "";
  if (/MasterSAT/i.test(ua)) {
    return { label: /iPad/.test(ua) ? "MasterSAT app on iPad" : "MasterSAT app on iPhone", kind: "app" };
  }

  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Mac OS X|Macintosh/.test(ua)
              ? "Mac"
              : /Linux/.test(ua)
                ? "Linux"
                : null;

  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /YaBrowser\//.test(ua)
          ? "Yandex Browser"
          : /Firefox\/|FxiOS\//.test(ua)
            ? "Firefox"
            : /Chrome\/|CriOS\//.test(ua)
              ? "Chrome"
              : /Safari\//.test(ua)
                ? "Safari"
                : null;

  const kind: DeviceKind =
    os === "iPhone" || (os === "Android" && /Mobile/.test(ua))
      ? "phone"
      : os === "iPad" || os === "Android"
        ? "tablet"
        : "computer";

  if (browser && os) return { label: `${browser} on ${os}`, kind };
  if (browser) return { label: browser, kind };
  if (os) return { label: os, kind };
  return { label: "Unknown device", kind };
}

/* ── Time ────────────────────────────────────────────────────────────────────────────── */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Active now", "12 minutes ago", "Yesterday", "Sep 3". For a device's last sign of life. */
export function lastActiveLabel(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "Active recently";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Active recently";
  const ago = Math.max(0, now - t);
  if (ago < 2 * MINUTE) return "Active now";
  if (ago < HOUR) return `Active ${Math.round(ago / MINUTE)} minutes ago`;
  if (ago < DAY) {
    const hours = Math.round(ago / HOUR);
    return `Active ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(ago / DAY);
  if (days === 1) return "Active yesterday";
  if (days < 7) return `Active ${days} days ago`;
  return `Active ${new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** Local midnight of a timestamp — every "today"/"tomorrow" below is the student's own day. */
function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A "YYYY-MM-DD" (a date with no time) as local midnight. `new Date("2026-09-14")` is UTC. */
export function localDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole days from today to a date, by the calendar rather than by 24-hour blocks. */
export function daysUntil(ymd: string | null | undefined, now: number = Date.now()): number | null {
  if (!ymd) return null;
  const d = localDate(ymd);
  if (!d) return null;
  return Math.round((dayStart(d.getTime()) - dayStart(now)) / DAY);
}

/* ── Homework ────────────────────────────────────────────────────────────────────────── */

/** One row of `GET /classes/my-assignments/`, only the fields the profile reads. */
export interface HomeworkRow {
  id: number;
  title?: string | null;
  due_at?: string | null;
  classroom_id?: number | null;
  classroom_name?: string | null;
  item_count?: number | null;
  content_type?: string | null;
  /** NOT_STARTED | IN_PROGRESS | RETURNED | SUBMITTED | GRADED — in EITHER case: the assessment
   *  path serves lowercase, the submission path uppercase. */
  workflow_status?: string | null;
}

/** Turned in: submitted or graded. RETURNED is not — it means "revise and send it back". */
export function isTurnedIn(status: string | null | undefined): boolean {
  return ["submitted", "graded"].includes((status ?? "").trim().toLowerCase());
}

export type DueTone = "catch-up" | "soon" | "later" | "none";

/** When a piece of work is due, said the growth-oriented way: a missed date is "Catch up". */
export function dueLabel(dueAt: string | null | undefined, now: number = Date.now()): { text: string; tone: DueTone } {
  if (!dueAt) return { text: "No due date", tone: "none" };
  const t = new Date(dueAt).getTime();
  if (Number.isNaN(t)) return { text: "No due date", tone: "none" };
  if (t < now) return { text: "Catch up", tone: "catch-up" };
  const days = Math.round((dayStart(t) - dayStart(now)) / DAY);
  if (days === 0) return { text: "Due today", tone: "soon" };
  if (days === 1) return { text: "Due tomorrow", tone: "soon" };
  return { text: `Due in ${days} days`, tone: days <= 3 ? "soon" : "later" };
}

export interface HomeworkSummary {
  total: number;
  turnedIn: number;
  /** Still to do, the one to start next first: past-due work, then by due date, undated last. */
  toDo: HomeworkRow[];
  /** Of `toDo`, how many are past their date. */
  catchUp: number;
}

export function summariseHomework(rows: HomeworkRow[], now: number = Date.now()): HomeworkSummary {
  const toDo = rows.filter((row) => !isTurnedIn(row.workflow_status));
  const due = (row: HomeworkRow) => {
    const t = row.due_at ? new Date(row.due_at).getTime() : Number.NaN;
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  toDo.sort((a, b) => due(a) - due(b) || a.id - b.id);
  return {
    total: rows.length,
    turnedIn: rows.length - toDo.length,
    toDo,
    catchUp: toDo.filter((row) => due(row) < now).length,
  };
}

/* ── Lessons ─────────────────────────────────────────────────────────────────────────── */

/** One event of `GET /classes/my-schedule/`. Only `type: "class"` rows are lessons. */
export interface ScheduleEvent {
  date: string;
  type: string;
  time?: string | null;
  classroom_id?: number | null;
}

export interface NextLesson {
  start: Date;
  /** The lesson is on right now. */
  live: boolean;
}

/**
 * A lesson's start and end. `time` is a start ("14:00") or a range ("08:00-10:00"); with only a
 * start, the lesson lasts the class's `hours`. A lesson with no time spans its whole day.
 */
function lessonWindow(event: ScheduleEvent, hours: number): { start: Date; end: number } | null {
  const day = localDate(event.date);
  if (!day) return null;
  const times = [...(event.time ?? "").matchAll(/(\d{1,2}):(\d{2})/g)];
  if (times.length === 0) return { start: day, end: day.getTime() + DAY };
  const start = new Date(day);
  start.setHours(Number(times[0][1]), Number(times[0][2]), 0, 0);
  let end = start.getTime() + hours * HOUR;
  if (times[1]) {
    const until = new Date(day);
    until.setHours(Number(times[1][1]), Number(times[1][2]), 0, 0);
    if (until.getTime() > start.getTime()) end = until.getTime();
  }
  return { start, end };
}

/**
 * The next lesson of one class: the one on now, or the first still to start.
 *
 * `hours` is the class's lesson length, so a lesson that began twenty minutes ago reads as on
 * now rather than as gone — "Next lesson: Wednesday" while the student is sitting in today's
 * would be wrong in the way that matters.
 */
export function nextLesson(
  events: ScheduleEvent[],
  classroomId: number,
  hours: number | null | undefined,
  now: number = Date.now(),
): NextLesson | null {
  const length = Math.max(0.5, Number(hours) || 2);
  let best: NextLesson | null = null;
  for (const event of events) {
    if (event.type !== "class" || event.classroom_id !== classroomId) continue;
    const window = lessonWindow(event, length);
    if (!window || window.end <= now) continue;
    if (!best || window.start.getTime() < best.start.getTime()) {
      best = { start: window.start, live: window.start.getTime() <= now };
    }
  }
  return best;
}

/** "On now", "Today at 14:00", "Tomorrow at 16:00", "Wed, Sep 16 at 14:00". */
export function lessonLabel(lesson: NextLesson, now: number = Date.now()): string {
  if (lesson.live) return "On now";
  const hhmm = `${String(lesson.start.getHours()).padStart(2, "0")}:${String(lesson.start.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((dayStart(lesson.start.getTime()) - dayStart(now)) / DAY);
  if (days === 0) return `Today at ${hhmm}`;
  if (days === 1) return `Tomorrow at ${hhmm}`;
  const date = lesson.start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${date} at ${hhmm}`;
}

/* ── Finishing the profile ───────────────────────────────────────────────────────────── */

export type ChecklistKey = "email" | "goal" | "exam" | "photo" | "telegram" | "phone";

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  /** What the step reads as once it is done: "Email confirmed". */
  doneLabel: string;
  /** Why it is worth doing — one short reason, never a warning. */
  hint: string;
  done: boolean;
}

/** The profile fields the checklist reads, as the page holds them. */
export interface ChecklistInput {
  realEmail: string;
  emailVerified: boolean;
  targetScore: number | null;
  examDate: string | null;
  photoUrl: string | null;
  telegramLinked: boolean;
  phone: string;
}

/**
 * The steps that make a profile useful, most useful first.
 *
 * Telegram is left off where the site has no Telegram sign-in, because a step nobody can take is
 * a step that can never be ticked.
 */
export function profileChecklist(input: ChecklistInput, { telegramAvailable }: { telegramAvailable: boolean }): ChecklistItem[] {
  const items: ChecklistItem[] = [
    {
      key: "email",
      label: input.realEmail ? "Confirm your email" : "Add your email",
      doneLabel: "Email confirmed",
      hint: "Your results and sign-in codes go there.",
      done: Boolean(input.realEmail) && input.emailVerified,
    },
    {
      key: "goal",
      label: "Set your target score",
      doneLabel: "Target score set",
      hint: "So you can see how far you've come.",
      done: input.targetScore != null,
    },
    {
      key: "exam",
      label: "Pick your SAT date",
      doneLabel: "SAT date picked",
      hint: "A countdown keeps the plan on track.",
      done: Boolean(input.examDate),
    },
    {
      key: "photo",
      label: "Add a profile photo",
      doneLabel: "Photo added",
      hint: "Your teachers and classmates see it in class.",
      done: Boolean(input.photoUrl),
    },
    {
      key: "telegram",
      label: "Connect Telegram",
      doneLabel: "Telegram connected",
      hint: "Sign in with one tap next time.",
      done: input.telegramLinked,
    },
    {
      key: "phone",
      label: "Add your phone number",
      doneLabel: "Phone number added",
      hint: "So your learning center can reach you.",
      done: Boolean(input.phone.trim()),
    },
  ];
  return telegramAvailable ? items : items.filter((item) => item.key !== "telegram" || item.done);
}

/* ── Results ─────────────────────────────────────────────────────────────────────────── */

/** The attempt fields `recentResults` reads (a structural subset of `GET /exams/attempts/`). */
export interface AttemptLike {
  id: number;
  submitted_at?: string | null;
  is_completed?: boolean;
  score?: number | null;
  practice_test_details?: { mock_kind?: string | null; mock_exam_id?: number | null } | null;
}

/**
 * The latest scored tests, newest first.
 *
 * Midterms are left out: their scores are released by the learning center on its own schedule,
 * and they have a page of their own that knows whether a result is out yet. Every other attempt
 * is one section, scored on its own scale — which is why none of these is set against the
 * 1600 target. The page this replaces did exactly that with whatever the last test was.
 */
export function recentResults<T extends AttemptLike>(attempts: T[], limit = 3): T[] {
  const time = (a: T) => (a.submitted_at ? new Date(a.submitted_at).getTime() : Number.NaN);
  return attempts
    .filter((a) => a.is_completed && typeof a.score === "number" && !Number.isNaN(time(a)))
    .filter((a) => (a.practice_test_details?.mock_kind ?? "").toUpperCase() !== "MIDTERM")
    .sort((a, b) => time(b) - time(a) || b.id - a.id)
    .slice(0, limit);
}

/** Where a finished attempt is reviewed: a mock's result page, or the question review. */
export function resultHref(attempt: AttemptLike): string {
  return attempt.practice_test_details?.mock_exam_id ? `/mock-exam/result/${attempt.id}` : `/review/${attempt.id}`;
}

/** "Reading & Writing" / "Math" out of the practice test's subject code. */
export function subjectLabel(subject: string | null | undefined): string {
  const s = (subject ?? "").toUpperCase();
  if (s === "MATH") return "Math";
  if (s === "READING_WRITING" || s === "ENGLISH") return "Reading & Writing";
  return "Practice";
}

/** The account's role as a person would say it. */
export function roleLabel(role: string | null | undefined): string {
  const r = (role ?? "").toLowerCase();
  if (r === "student" || r === "") return "Student";
  if (r === "support_teacher") return "Support teacher";
  if (r === "teacher") return "Teacher";
  if (r === "test_admin" || r === "test_auditor") return "Content team";
  return "Staff";
}

/* ── Goals ───────────────────────────────────────────────────────────────────────────── */

export const SECTION_MIN = 200;
export const SECTION_MAX = 800;

/**
 * The section targets a student starts the editor from: the stored ones, else the total split
 * evenly (English to the nearest 10, Math the rest) — the dashboard's rule, so the two screens
 * never disagree about what the goal is — else 650 each.
 */
export function initialSectionTargets(
  total: number | null,
  english: number | null,
  math: number | null,
): { english: number; math: number } {
  const clamp = (v: number) => Math.max(SECTION_MIN, Math.min(SECTION_MAX, Math.round(v / 10) * 10));
  if (english != null && math != null) return { english: clamp(english), math: clamp(math) };
  if (total != null) {
    const e = clamp(Math.round(total / 20) * 10);
    return { english: e, math: clamp(total - e) };
  }
  return { english: 650, math: 650 };
}
