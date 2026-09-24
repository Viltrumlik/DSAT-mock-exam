/**
 * One homework's submissions — the work itself, for a teacher about to mark it.
 *
 * `GET /api/classes/<class>/assignments/<homework>/submissions/` is the only read that carries
 * what the student actually turned in: the uploaded pdf or jpg, the test attempt a locked
 * homework is handed in as, and `composed_grade`. The gradebook's own two reads carry statuses,
 * counts and grades and have never carried a file, which is why the Grading tab could take a
 * mark without ever showing the work it was for.
 *
 * The request is the one the teacher panel's grading screen already makes. The reading of it is
 * this app's own: `features/classroom/**` is mounted by the student host too, and importing that
 * screen's module would pull the whole teacher dashboard queue in behind it.
 *
 * Nothing here talks to React, and none of it re-derives the composed grade — that arithmetic
 * lives once, in `backend/classes/grade_composition.py`, and a second copy here would eventually
 * disagree with the number the student is shown.
 */

import { classesApi } from "@/lib/api";

/** A file the student uploaded. `url` is absolute; the rest is best-effort, as the API sends it. */
export interface SubmissionFile {
  id?: number;
  url: string;
  file_name?: string | null;
  file_type?: string | null;
}

/** The practice/assessment attempt a homework that locks file upload is turned in as. */
export interface SubmissionAttempt {
  id?: number;
  score?: number | null;
  practice_test_name?: string | null;
  practice_test_title?: string | null;
  is_completed?: boolean;
}

/** `ComposedGrade.as_payload()`. The whole key is null on homework with no manual share. */
export interface ComposedGrade {
  state: string;
  percent: number | null;
  is_final: boolean;
  automatic_percent: number | null;
  manual_percent: number | null;
  manual_weight_percent: number;
  automatic_weight_percent: number;
}

/** One row of the submissions list, in the shape `SubmissionSerializer` sends. */
export interface WorkSubmission {
  id: number;
  /** UPPERCASE in the classes app — SUBMITTED / REVIEWED / RETURNED / DRAFT. */
  status?: string | null;
  workflow_status?: string | null;
  submitted_at?: string | null;
  return_note?: string | null;
  files?: SubmissionFile[];
  attempt?: SubmissionAttempt | null;
  student?: { id?: number } | null;
  review?: { grade?: number | string | null; feedback?: string | null } | null;
  composed_grade?: ComposedGrade | null;
}

/** Whatever the list returned, as rows with a usable id. A non-array reads as none. */
export function parseSubmissions(raw: unknown): WorkSubmission[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is WorkSubmission => !!r && typeof r === "object" && typeof (r as WorkSubmission).id === "number")
    .map((r) => ({ ...r, files: Array.isArray(r.files) ? r.files.filter((f) => f && typeof f.url === "string" && f.url) : [] }));
}

export const submissionsApi = {
  forAssignment: async (classId: number, assignmentId: number): Promise<WorkSubmission[]> =>
    parseSubmissions(await classesApi.listSubmissions(classId, assignmentId)),
};

/**
 * This student's row, by the submission the gradebook named and then by the student on it.
 *
 * Both, because the two reads disagree by design about one case: the gradebook calls a DRAFT
 * submission "not turned in" while still carrying its id, so the id alone would open a row the
 * list says is not there, and the student alone would miss nothing.
 */
export function submissionFor(
  subs: readonly WorkSubmission[],
  { submissionId, studentId }: { submissionId: number | null; studentId: number },
): WorkSubmission | null {
  if (submissionId != null) {
    const byId = subs.find((s) => s.id === submissionId);
    if (byId) return byId;
  }
  return subs.find((s) => s.student?.id === studentId) ?? null;
}

/** What the teacher's mark is worth on this homework, read off `composed_grade`. */
export type ManualShare = {
  /** The share the teacher awards by hand, 0-100 — as APPLIED, which is not always as typed. */
  manualWeight: number;
  automaticWeight: number;
  /** The engines' part on its own 0-100 scale. Null when nothing here is graded automatically. */
  automaticPercent: number | null;
  /** The whole grade as it stands. Null while nothing that carries weight has a number behind it. */
  percent: number | null;
  /** The mark is still owed AND can still move `percent`. */
  awaiting: boolean;
  /** The composition could not be read. This is a failure, never "no grade yet". */
  unavailable: boolean;
};

const STATE_NO_MANUAL_COMPONENT = "no_manual_component";
const STATE_AWAITING_MANUAL = "awaiting_manual_mark";
const STATE_UNAVAILABLE = "unavailable";

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * `null` means this homework has no manual share and the screen shows nothing about one — the
 * behaviour of every homework set before the share was asked for, which is nearly all of them.
 *
 * The state is the server's own word, never re-derived: "the teacher has not marked yet" and
 * "we could not work it out" are different answers and only the backend knows which.
 */
export function describeManualShare(composed: ComposedGrade | null | undefined): ManualShare | null {
  if (!composed || composed.state === STATE_NO_MANUAL_COMPONENT) return null;
  const manualWeight = clampPercent(finite(composed.manual_weight_percent) ?? 0);
  const automaticWeight = clampPercent(finite(composed.automatic_weight_percent) ?? 100 - manualWeight);
  return {
    manualWeight,
    automaticWeight,
    automaticPercent: finite(composed.automatic_percent),
    percent: finite(composed.percent),
    awaiting: composed.state === STATE_AWAITING_MANUAL,
    unavailable: composed.state === STATE_UNAVAILABLE,
  };
}

/**
 * The next student to open, in the list as the teacher has it filtered.
 *
 * A student graded under "Needs grading" leaves that filter the moment the grade lands, so the
 * one on screen is often no longer in the list. The walk then resumes at its head rather than
 * stopping — the same rule the panel's grading screen skips by.
 */
export function nextStudentIn(ids: readonly number[], current: number): number | null {
  const i = ids.indexOf(current);
  return (i >= 0 ? ids[i + 1] : ids[0]) ?? null;
}

export function previousStudentIn(ids: readonly number[], current: number): number | null {
  const i = ids.indexOf(current);
  return i > 0 ? ids[i - 1] : null;
}
