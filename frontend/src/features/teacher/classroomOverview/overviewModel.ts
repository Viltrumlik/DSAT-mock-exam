/**
 * What "what needs me today" is, as plain functions over data the classroom workspace already
 * fetches. Nothing here calls the network.
 *
 * What opening a class as staff costs, plainly, because it is NOT what it cost before. Overview
 * used to fire one request (`/rankings/academic/`, which is now lazy and only on request); it
 * now fires five:
 *   GET /classes/<id>/lessons/                      — useLessonPlan
 *   GET /classes/<id>/attendance/sessions/          — useAttendanceSessions
 *   GET /classes/<id>/gradebook/                    — useGradebookOverview  (serves two blocks)
 *   GET /classes/<id>/gradebook/assignments/<id>/   — useGradebookAssignment (only once the
 *                                                     summary has named a homework)
 *   GET /classes/<id>/interventions/                — useClassInterventions
 * Each is an endpoint and a hook the workspace or the teacher panel already owns — no new
 * server surface — but five is not one, and a reader should not have to count them.
 *
 * One of them is not a read: `GET /attendance/sessions/` calls `attendance_auto.ensure_sessions`
 * (views_attendance.py:103), so opening the Overview MATERIALISES today's register for the
 * class. That is the intended behaviour of that endpoint — a class with no scheduler still gets
 * its register the moment a teacher opens the page — but it is a write, and it now happens on
 * a page a teacher lands on rather than on one they navigated to.
 *
 * The derivations live apart from the component so the reading of each number is testable on
 * its own — "turned in" in particular, which is the one figure a teacher will act on before
 * the lesson and which has been computed three different ways in three places in this product.
 */

import type { LessonPlan, LessonRow } from "@/features/classroom/lessonsApi";
import type { AttendanceSessionBrief } from "@/features/classroom/attendanceApi";
import type { AssignmentMeta, GradebookCounts, GradebookOverview, RosterRow } from "@/features/classroom/gradebookApi";

/** Today as the browser reads it, `YYYY-MM-DD` — the shape the register's `date` comes in. */
export function localDay(at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The calendar day of a date or datetime the server sent, comparable against `localDay()`. */
function dayOf(iso: string | null | undefined): string | null {
  return iso && iso.length >= 10 ? iso.slice(0, 10) : null;
}

/** "Tue, Sep 23" — and the two days a teacher reads as words rather than as a date. */
export function dayLabel(iso: string | null | undefined, today = localDay()): string {
  const day = dayOf(iso);
  if (!day) return "No date";
  if (day === today) return "Today";
  const t = new Date(`${today}T00:00:00`).getTime();
  const d = new Date(`${day}T00:00:00`).getTime();
  if (!Number.isNaN(t) && !Number.isNaN(d) && Math.round((d - t) / 86400000) === 1) return "Tomorrow";
  return Number.isNaN(d)
    ? day
    : new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// ── The register ────────────────────────────────────────────────────────────

/**
 * `none` is not "nothing happened": a register materialises server-side on a lesson day, so no
 * session dated today means there is no lesson today — which is why it reads as calm and not as
 * a job left undone.
 *
 * Two states, not three, and the reason is the payload. `AttendanceSessionBrief.counts` looks
 * like it would tell a half-marked register from an untouched one, but the endpoint never fills
 * it: `_session_brief` (backend/classes/views_attendance.py:78) takes `counts` as an optional
 * argument and ALL FIVE call sites omit it, so it is `null` in every response. Reading it and
 * calling zero "nobody has marked this" told a teacher who had just marked all twelve students
 * that the register was untouched — the exact lie this overview is built against. So the state
 * is named by what the payload actually knows: whether the register has been FINALIZED.
 */
export type RegisterState = "marked" | "open" | "none";

export function todayRegister(
  sessions: AttendanceSessionBrief[] | undefined,
  today = localDay(),
): { state: RegisterState; session: AttendanceSessionBrief | null } {
  const session = (sessions ?? []).find((s) => dayOf(s.date) === today) ?? null;
  if (!session) return { state: "none", session: null };
  return { state: session.status === "FINALIZED" ? "marked" : "open", session };
}

// ── The plan ────────────────────────────────────────────────────────────────

function scheduledFrom(plan: LessonPlan | undefined, today: string, type?: LessonRow["lesson_type"]): LessonRow | null {
  const rows = (plan?.lessons ?? [])
    .filter((l) => (type ? l.lesson_type === type : true))
    .filter((l) => {
      const day = dayOf(l.scheduled_for);
      return day != null && day >= today;
    })
    .sort((a, b) => String(a.scheduled_for).localeCompare(String(b.scheduled_for)));
  return rows[0] ?? null;
}

/** The next lesson the plan has a date for, today's included — a lesson today is still ahead. */
export function nextLesson(plan: LessonPlan | undefined, today = localDay()): LessonRow | null {
  return scheduledFrom(plan, today);
}

/** The midterm coming, if any. There often is not one, and that is not an empty state. */
export function comingMidterm(plan: LessonPlan | undefined, today = localDay()): LessonRow | null {
  return scheduledFrom(plan, today, "MIDTERM");
}

// ── The homework ────────────────────────────────────────────────────────────

export type DueHomework = AssignmentMeta & { counts: GradebookCounts };

/**
 * The homework the class owes at its next lesson: the nearest deadline that has not gone past,
 * counted by DAY rather than by the minute — homework due at 18:00 is still the thing the
 * teacher is chasing at 19:00, and a block that went quiet the instant the deadline passed
 * would hide exactly the work that needs chasing.
 *
 * Drafts never appear: the server leaves them out of the gradebook, and no student has been
 * given one. Archived homework is filtered here — it is hidden from students, so it cannot be
 * what they owe next.
 */
export function dueNext(overview: GradebookOverview | undefined, today = localDay()): DueHomework | null {
  const rows = (overview?.assignments ?? [])
    .filter((a) => a.status === "PUBLISHED")
    .filter((a) => {
      const day = dayOf(a.due_at);
      return day != null && day >= today;
    })
    .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
  return rows[0] ?? null;
}

/**
 * Turned in = everyone who handed something over, whatever became of it afterwards. Work sent
 * back for revision was still turned in, and counting only `graded + needs_grading` — the other
 * obvious reading — would have a teacher chasing a student who has already done the work.
 */
export function turnedIn(counts: GradebookCounts): number {
  return Math.max(0, (counts.total ?? 0) - (counts.missing ?? 0));
}

/** Who has not turned it in, by name. "Not turned in" is the status the class list shows. */
export function notTurnedIn(roster: RosterRow[] | undefined): RosterRow[] {
  return (roster ?? []).filter((r) => r.status === "MISSING");
}

// ── The grading queue ───────────────────────────────────────────────────────

export interface WaitingRow {
  id: number;
  title: string;
  waiting: number;
}

/**
 * What is waiting for this teacher's own judgement. Auto-graded work is left out: the server
 * folds its submissions into `graded`, and a quiz that marks itself is never a job.
 */
export function waitingToGrade(overview: GradebookOverview | undefined): WaitingRow[] {
  return (overview?.assignments ?? [])
    .filter((a) => !a.is_auto_graded && (a.counts?.needs_grading ?? 0) > 0)
    .map((a) => ({ id: a.id, title: a.title, waiting: a.counts.needs_grading }))
    .sort((a, b) => b.waiting - a.waiting);
}

// ── The students ────────────────────────────────────────────────────────────

interface InterventionStudent {
  student_id?: number;
  user_id?: number;
  id?: number;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}

/** `GET /classes/<id>/interventions/` — the slice of it this overview reads. */
export interface InterventionsPayload {
  overdue_students?: (InterventionStudent & { overdue_count?: number | null })[];
  inactive_students?: (InterventionStudent & { days_inactive?: number | null })[];
  low_score_students?: (InterventionStudent & { avg_score_pct?: number | null })[];
}

export interface AttentionItem {
  id: string;
  name: string;
  reason: string;
  tone: "danger" | "warning";
}

function idOf(s: InterventionStudent): number | null {
  const raw = s.student_id ?? s.user_id ?? s.id;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function nameOf(s: InterventionStudent): string {
  return [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || s.email || "Student";
}

/**
 * The handful of students to speak to. One row per student however many signals they trip — a
 * teacher wants a person to find in the room, not a list of symptoms.
 *
 * The three signals are taken in ROUNDS, not one whole list after another. Draining the low
 * averages first meant a class with six students under the threshold filled all five rows with
 * averages, and the student with eight pieces not turned in never appeared at all — the signal
 * a teacher can act on soonest was the one the list hid. Round-robin keeps the server's
 * severity order inside each signal while guaranteeing each signal a place, and still fills
 * from whatever is left once a list runs out.
 *
 * The wording is the panel's: work not turned in is "not turned in", never "missing", and a
 * quiet student is described by what has not happened rather than labelled for it.
 */
export function attentionItems(iv: InterventionsPayload | undefined, limit = 5): AttentionItem[] {
  const out: AttentionItem[] = [];
  const seen = new Set<number>();
  const push = (s: InterventionStudent, reason: string, tone: AttentionItem["tone"]) => {
    const id = idOf(s);
    if (id == null || seen.has(id)) return;
    seen.add(id);
    out.push({ id: String(id), name: nameOf(s), reason, tone });
  };
  // Hardest signal first WITHIN a round, so a student who trips two is described by the worse.
  const signals: { row: InterventionStudent; reason: string; tone: AttentionItem["tone"] }[][] = [
    (iv?.low_score_students ?? []).map((s) => ({
      row: s, reason: `Averaging ${Math.round(Number(s.avg_score_pct) || 0)}%`, tone: "danger" as const,
    })),
    (iv?.overdue_students ?? []).map((s) => {
      const n = Math.max(1, Math.round(Number(s.overdue_count) || 0));
      return { row: s, reason: `${n} ${n === 1 ? "piece" : "pieces"} not turned in`, tone: "warning" as const };
    }),
    (iv?.inactive_students ?? []).map((s) => {
      const d = Math.max(1, Math.round(Number(s.days_inactive) || 0));
      return { row: s, reason: `No activity for ${d} ${d === 1 ? "day" : "days"}`, tone: "warning" as const };
    }),
  ];
  const deepest = Math.max(0, ...signals.map((g) => g.length));
  for (let round = 0; round < deepest && out.length < limit; round++) {
    for (const group of signals) {
      if (out.length >= limit) break;
      const r = group[round];
      if (r) push(r.row, r.reason, r.tone);
    }
  }
  return out.slice(0, limit);
}

/** The server's `detail` when a request was refused with a reason; null when it gave none. */
export function detailOf(e: unknown): string | null {
  const d = (e as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  return typeof d === "string" ? d : null;
}
