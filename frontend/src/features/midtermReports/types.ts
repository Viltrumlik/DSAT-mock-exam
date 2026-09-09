/**
 * Wire types for the admin midterm reports API (backend: `midterms/admin_report.py`).
 *
 * Kept local to this feature rather than added to `lib/midtermApi.ts`: that client serves the
 * student/teacher surfaces, and these three read-only admin endpoints share none of its shapes.
 */

/**
 * A student's state on one midterm. All but ABSENT are `MidtermAttempt.current_state`;
 * ABSENT is synthesized by the report for a roster member with no attempt row at all.
 *
 * This endpoint sends the RAW DB state (`admin_report.sitting_for` returns
 * `attempt.current_state` untouched — WIRE_STATE is not applied here), so the vocabulary is
 * `midterms/state_machine.py`'s, MODULE_2_ACTIVE included. It was missing, and a student
 * halfway through module 2 therefore read as "No score recorded" — which says the paper came
 * back empty rather than that they are still sitting it. Every consumer nonetheless goes
 * through a fallback, because the type can only ever describe the states that existed when
 * it was written.
 */
export type MidtermState =
  | "ABSENT"
  | "NOT_STARTED"
  | "ACTIVE"
  | "MODULE_2_ACTIVE"
  | "SCORING"
  | "COMPLETED"
  | "ABANDONED";

/**
 * NOT_GRADED is a finished PRE_MIDTERM: scored, but a diagnostic is never judged. It is
 * deliberately distinct from PENDING ("a verdict is still coming") and must never be
 * rendered as a failure.
 */
export type FinalStatus =
  | "PASSED"
  | "PASSED_ON_RETAKE"
  | "FAILED"
  | "ABSENT"
  | "PENDING"
  | "NOT_GRADED";

export type ClassroomBrief = {
  id: number;
  name: string;
  subject: string;
  level: string;
  teacher_name: string;
  teacher_profile_image_url?: string | null;
};

export type ClassroomListRow = ClassroomBrief & {
  student_count: number;
  midterm_count: number;
};

export type MidtermBrief = {
  id: number;
  title: string;
  subject: string;
  subject_label: string;
  midterm_type: "PRE_MIDTERM" | "MIDTERM" | "RETAKE";
  /**
   * The score needed to pass — or null when this midterm is not pass/fail graded at all
   * (a PRE_MIDTERM). Null is the ONLY signal of that, so every verdict must be derived
   * through `isGraded()` rather than compared against a score directly.
   */
  pass_mark: number | null;
  score_ceiling: number;
  scoring_scale: string;
};

export type Counts = { passed: number; failed: number; absent: number; pending: number };

export type RetakeBrief = { id: number; title: string };

export type ClassroomMidtermRow = MidtermBrief & {
  scheduled_at: string | null;
  counts: Counts;
  /**
   * The OLDEST retake of this paper — the one the per-student table heads its retake column
   * with. Kept beside `retakes` for the single-retake reader; it is a name for a column, not
   * a count of anything.
   */
  retake: RetakeBrief | null;
  /**
   * Every retake of this paper, oldest first. `ReportClassroomDetailView` sends it beside
   * `retake`, so a reader can state the count exactly instead of hedging about what it cannot
   * see. Still read through {@link retakeCountOf}, which answers `null` — "unknown", never 0 —
   * if an older server ever omits it.
   */
  retakes: RetakeBrief[];
};

export type ClassroomDetail = { classroom: ClassroomBrief; midterms: ClassroomMidtermRow[] };

export type ReportRow = {
  student_id: number;
  student_name: string;
  student_profile_image_url?: string | null;
  midterm_score: number | null;
  midterm_state: MidtermState;
  midterm_passed: boolean | null;
  retake_score: number | null;
  retake_state: MidtermState | null;
  retake_passed: boolean | null;
  /** True only for a student who failed AND has a retake to sit. */
  retake_eligible: boolean;
  final_status: FinalStatus;
};

export type ReportSummary = Counts & {
  students: number;
  pass_mark: number | null;
  average_score: number | null;
};

export type MidtermReport = {
  classroom: ClassroomBrief;
  midterm: MidtermBrief;
  /**
   * The paper the retake COLUMN is headed by: the oldest retake, and its score ceiling is the
   * "out of N" printed in that header. A row's cell may nonetheless come from any of
   * {@link MidtermReport.retakes} — `admin_report.resolve_retake` takes the first pass across
   * all of them — which is precisely why both are on the wire.
   */
  retake: MidtermBrief | null;
  /** Every retake of this paper, oldest first. The rows are resolved across all of them. */
  retakes: MidtermBrief[];
  summary: ReportSummary;
  rows: ReportRow[];
};
