/**
 * The exam attempt contract, mirrored from the website's runner
 * (frontend/src/features/testing-simulation/types/attempt.ts). The server is authoritative: it
 * owns the timer, the state machine and scoring; the client renders truth and submits intent.
 *
 * Plain types for now — the Zod parser + real transport land with the API-wiring increment.
 */

export type AttemptState =
  | "NOT_STARTED"
  | "MODULE_1_ACTIVE"
  | "MODULE_1_SUBMITTED"
  | "MODULE_2_ACTIVE"
  | "MODULE_2_SUBMITTED"
  | "SCORING"
  | "COMPLETED"
  | "ABANDONED";

export type QuestionType = "MATH" | "READING" | "WRITING";

export interface ExamQuestion {
  id: number;
  question_type: QuestionType;
  question_text: string;
  question_prompt?: string;
  question_image?: string | null;
  /** true → a student-produced response (grid-in), not multiple choice. */
  is_math_input?: boolean;
  /** Dynamic { "A": value, "B": value, … }; value is a string or { text, image }. */
  options?: unknown;
}

export interface ActiveModule {
  id: number;
  module_order: number; // 1 | 2
  time_limit_minutes: number;
  questions: ExamQuestion[];
}

export interface PracticeTestDetails {
  id: number;
  subject: string; // "MATH" | "READING_WRITING"
  title: string;
  total_question_count?: number;
  calculator_enabled?: boolean;
  modules?: { id: number; module_order: number; time_limit_minutes: number }[];
  /** "MIDTERM" on a midterm snapshot (backend/midterms/serializers.py). */
  mock_kind?: string;
  calculator_mode?: string | null;
  // Read forward-compatibly, as the site does; the midterm serializer does not send these yet,
  // and the rules screen quotes a pass mark only when they arrive.
  scoring_scale?: string | null;
  pass_mark?: number | null;
  midterm_type?: string | null;
}

export interface Attempt {
  id: number;
  current_state: AttemptState;
  version_number: number;
  practice_test_details: PracticeTestDetails;
  current_module: number | null;
  current_module_details: ActiveModule | null;
  current_module_start_time: string | null;
  // Server-authoritative timing.
  server_now: string;
  remaining_seconds: number | null;
  module_duration_seconds: number | null;
  // Persisted per-module work, for rehydration after a refresh.
  current_module_saved_answers: Record<string, unknown> | null;
  current_module_flagged_questions: number[] | null;
  // Lifecycle.
  is_completed: boolean;
  is_expired: boolean;
  is_paused: boolean;
  can_submit?: boolean;
  score?: number | null;
  // Midterm only. Whether this sitting must be taken locked down in the app (the server's
  // MIDTERM_DESKTOP_REQUIRED, per sitting) — present on status/start/save snapshots.
  desktop_required?: boolean;
  // The off-screen rule's tally, on every midterm snapshot: the SERVER counts, the app renders.
  offscreen_violations?: number;
  offscreen_limit?: number;
  offscreen_grace_seconds?: number;
  /** "OFFSCREEN" once the rule took the paper in; "" otherwise. */
  terminated_reason?: string;
}

/** What POST {base}/{id}/offscreen/ answers. `attempt` is absent once the paper is in. */
export interface OffscreenReport {
  violations?: number;
  limit?: number;
  grace_seconds?: number;
  terminated?: boolean;
  attempt?: unknown;
}

export interface ParsedOption {
  key: string;
  text: string;
  image?: string | null;
}
