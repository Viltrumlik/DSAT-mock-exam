/**
 * Domain: Scoring
 * Types for attempt scoring, grading metrics, and scoring failure recovery.
 */

/**
 * Scoring pipeline state for a single attempt.
 * Mirrors governance document Part 1.5.
 */
export type AttemptScoringState =
  | "STARTED"
  | "SUBMITTED"
  | "SCORING"
  | "SCORED"
  | "SCORE_FAILED"
  | "REVIEWED"
  | "DISPUTED"
  | "RESOLVED";

/**
 * A failed attempt that needs admin attention.
 */
export type ScoringFailure = {
  attemptId: number;
  assignmentId: number;
  assignmentTitle: string;
  classroomId: number;
  classroomName: string;
  studentName: string;
  submittedAt: string;
  failedAt: string;
  retryCount: number;
  errorDetail?: string;
};

/**
 * Grading pipeline health metrics for the ops dashboard.
 * Mirrors GET /assessments/admin/grading/metrics/ response shape.
 */
export type GradingMetrics = {
  queue: {
    pending: number;
    processing: number;
    failed_total: number;
  };
  rates_24h: {
    completed: number;
    failed: number;
    failure_rate: number;
    avg_grading_attempts: number | null;
  };
  latency_seconds: {
    p50: number | null;
    p90: number | null;
    p99: number | null;
    sample_n: number;
  };
  trend: {
    submitted_5m: number;
    graded_5m: number;
    failed_5m: number;
    submitted_60m: number;
    graded_60m: number;
    failed_60m: number;
  };
  pending_age: {
    p50: number | null;
    p90: number | null;
    p99: number | null;
  };
  broker: {
    enabled: boolean;
    transport: string | null;
    queue_len: number | null;
  };
};
