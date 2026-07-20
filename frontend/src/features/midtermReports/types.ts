/**
 * Wire types for the admin midterm reports API (backend: `midterms/admin_report.py`).
 *
 * Kept local to this feature rather than added to `lib/midtermApi.ts`: that client serves the
 * student/teacher surfaces, and these three read-only admin endpoints share none of its shapes.
 */

/**
 * A student's state on one midterm. All but ABSENT are `MidtermAttempt.current_state`;
 * ABSENT is synthesized by the report for a roster member with no attempt row at all.
 */
export type MidtermState =
  | "ABSENT"
  | "NOT_STARTED"
  | "ACTIVE"
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

export type ClassroomMidtermRow = MidtermBrief & {
  scheduled_at: string | null;
  counts: Counts;
  retake: { id: number; title: string } | null;
};

export type ClassroomDetail = { classroom: ClassroomBrief; midterms: ClassroomMidtermRow[] };

export type ReportRow = {
  student_id: number;
  student_name: string;
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
  retake: MidtermBrief | null;
  summary: ReportSummary;
  rows: ReportRow[];
};
