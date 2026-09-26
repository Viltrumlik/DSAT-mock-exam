/**
 * The grading walk, as data: the queue flattened into an order, and one homework's submissions
 * read out of what `GET /api/classes/<id>/assignments/<id>/submissions/` sent.
 *
 * It lives apart from the screen because "who comes next" is the whole point of the rebuild —
 * a teacher grading 134 pieces in one class must never be sent back to a list to find the next
 * one — and because a rule kept in a component is a rule nothing can test.
 *
 * Nothing here talks to the network or to React.
 */

import type { QueueClass } from "../useTeacherToday";

/** A file the student uploaded. `url` is absolute; the rest is best-effort, as the API sends it. */
export type GradingFile = {
  id?: number;
  url: string;
  file_name?: string | null;
  file_type?: string | null;
};

export type GradingStudent = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  username?: string | null;
  profile_image_url?: string | null;
};

/** One row of `listSubmissions`, in the shape `SubmissionSerializer` sends. */
export type GradingSubmission = {
  id: number;
  /** `Submission.status`, UPPERCASE in the classes app — SUBMITTED / REVIEWED / RETURNED / DRAFT. */
  status?: string | null;
  workflow_status?: string | null;
  /** The concurrency guard the grade/return endpoints check. Absent on an older payload. */
  revision?: number | null;
  submitted_at?: string | null;
  return_note?: string | null;
  files?: GradingFile[];
  attempt?: {
    id?: number;
    score?: number | null;
    practice_test_name?: string | null;
    practice_test_title?: string | null;
    is_completed?: boolean;
  } | null;
  student?: GradingStudent | null;
  review?: { grade?: number | string | null; feedback?: string | null } | null;
};

/** One stop on the walk: a homework inside a class, named so the screen can say where it is. */
export type QueueStop = {
  classId: number;
  className: string;
  assignmentId: number;
  title: string;
  /** The true number waiting on that homework, as the server counted it — not the list's length. */
  waiting: number;
};

/** What the screen is showing, and what the address bar says: class → homework → student. */
export type Selection = { classId: number | null; assignmentId: number | null; studentId: number | null };

/**
 * The deep link `/teacher/grading?class=<id>&homework=<id>&student=<id>`, read from whatever
 * the address carried. Anything that is not a positive whole number is no selection at all, so
 * a mangled link opens the top of the queue rather than an error.
 */
export function selectionFromParams(get: (key: string) => string | null | undefined): Selection {
  const num = (raw: string | null | undefined): number | null =>
    raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
  const classId = num(get("class"));
  const assignmentId = classId == null ? null : num(get("homework"));
  return {
    classId,
    assignmentId,
    // A student without their homework cannot be found, so it is dropped rather than half-applied.
    studentId: assignmentId == null ? null : num(get("student")),
  };
}

/** A display name, never an email if a name exists — the same order the server's queue uses. */
export function studentLabel(s: GradingStudent | null | undefined): string {
  if (!s) return "Student";
  const name = `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
  if (name) return name;
  const username = (s.username ?? "").trim();
  if (username && !username.includes("@")) return username;
  return (s.email ?? "").trim() || "Student";
}

/**
 * Waiting means SUBMITTED, which is what the dashboard's queue counts: REVIEWED is done and
 * RETURNED has already been read and sent back. `workflow_status` is only consulted when the
 * row carries no `status` — the two cannot disagree (models.submission_workflow_status).
 */
export function isWaiting(s: GradingSubmission): boolean {
  const status = (s.status ?? s.workflow_status ?? "").toUpperCase();
  return status === "SUBMITTED";
}

/** Whatever `listSubmissions` returned, as rows with a usable id. A non-array reads as none. */
export function parseSubmissions(raw: unknown): GradingSubmission[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is GradingSubmission => !!r && typeof r === "object" && typeof (r as GradingSubmission).id === "number")
    .map((r) => ({ ...r, files: Array.isArray(r.files) ? r.files : [] }));
}

/**
 * The students still waiting on this homework, longest-waiting first — the order the teacher
 * works through. `graded` holds the ones settled in this session: the server has been told, but
 * the refetch may not have landed yet, and the next student must not wait on a round trip.
 *
 * A row with no `submitted_at` sorts last rather than being dropped: the column is nullable and
 * the work is still on the desk.
 */
export function waitingSubmissions(subs: GradingSubmission[], graded: ReadonlySet<number>): GradingSubmission[] {
  return subs
    .filter((s) => isWaiting(s) && !graded.has(s.id))
    .sort((a, b) => {
      const at = a.submitted_at ? new Date(a.submitted_at).getTime() : Number.POSITIVE_INFINITY;
      const bt = b.submitted_at ? new Date(b.submitted_at).getTime() : Number.POSITIVE_INFINITY;
      if (at !== bt) return at - bt;
      return a.id - b.id;
    });
}

export function submissionOfStudent(subs: GradingSubmission[], studentId: number | null): GradingSubmission | null {
  if (studentId == null) return null;
  return subs.find((s) => s.student?.id === studentId) ?? null;
}

/**
 * The queue as one ordered list of homework. The server has already put the classes with most
 * waiting first and, inside a class, the homework whose oldest piece has waited longest — so the
 * walk is simply that order, flattened.
 */
export function flattenQueue(queue: QueueClass[]): QueueStop[] {
  const stops: QueueStop[] = [];
  for (const klass of queue) {
    for (const asg of klass.assignments) {
      stops.push({
        classId: klass.classroomId,
        className: klass.name,
        assignmentId: asg.assignmentId,
        title: asg.title,
        waiting: asg.waiting,
      });
    }
  }
  return stops;
}

export function findStop(stops: QueueStop[], classId: number | null, assignmentId: number | null): QueueStop | null {
  if (classId == null || assignmentId == null) return null;
  return stops.find((s) => s.classId === classId && s.assignmentId === assignmentId) ?? null;
}

/**
 * The homework after this one: the next in the same class, then the first of the next class.
 * That is exactly the flattened order, so "next homework" is the following entry.
 *
 * A homework can also be GONE from the queue by the time we ask — grading its last waiting
 * piece takes it out on the next refetch, and the teacher is still standing on it. `findIndex`
 * then returns -1, and walking from the top of the queue would send the teacher backwards over
 * classes they have already worked through. So the caller passes `resumeIndex`: the position
 * this homework last held. Removing an entry slides its successor into that very index, which
 * is why resuming there — and not at zero — is the continuation of the same walk.
 */
export function nextStopAfter(
  stops: QueueStop[],
  classId: number | null,
  assignmentId: number | null,
  resumeIndex = 0,
): QueueStop | null {
  const i = stops.findIndex((s) => s.classId === classId && s.assignmentId === assignmentId);
  if (i >= 0) return stops[i + 1] ?? null;
  return stops[resumeIndex] ?? null;
}
