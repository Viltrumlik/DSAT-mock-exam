import api from "@/lib/api";

import type { components } from "@/lib/openapi-types";
import type { AttemptAnswerRequest, AttemptStartRequest, AttemptSubmitRequest, Attempt } from "@/features/assessments/types";
import type { SaveAnswerResponse, SubmitResponse } from "@/features/assessments/schemas";

type AssessmentAttemptBundleResponse = components["schemas"]["AssessmentAttemptBundleResponse"];
type AssessmentMyResultResponse = components["schemas"]["AssessmentMyResultResponse"];

// ─── Pedagogical review types ─────────────────────────────────────────────────

export type PedagogicalReviewQuestion = {
  id: number;
  order: number;
  prompt: string;
  question_prompt: string; // passage / stimulus
  question_type: string;
  choices: { key: string; text: string }[];
  points: number;
  correct_answer: unknown;
  explanation: string;
  // Student performance
  student_answer: unknown | null;
  is_correct: boolean | null;
  points_awarded: number | null;
};

export type PedagogicalReviewResult = {
  score_points: number;
  max_points: number;
  percent: number;
  correct_count: number;
  total_questions: number;
} | null;

export type PedagogicalReviewMeta = {
  assignment_id: number | null;
  assignment_title: string | null;
  set_title: string | null;
  set_category: string | null;
  due_at: string | null;
  question_count: number;
  classroom_name: string | null;
};

export type TeacherFeedback = {
  body: string;
  teacher_name: string | null;
  updated_at: string;
};

export type PedagogicalReviewBundle = {
  meta: PedagogicalReviewMeta;
  result: PedagogicalReviewResult;
  questions: PedagogicalReviewQuestion[];
  snapshot_pinned: boolean;
  teacher_feedback: TeacherFeedback | null;
};

// ─── Teacher submission queue types ───────────────────────────────────────────

export type SubmissionQueueItem = {
  attempt_id: number;
  student_name: string;
  student_email: string;
  submitted_at: string | null;
  status: "submitted" | "graded";
  grading_status: string;
  result_percent: number | null;
  result_correct_count: number | null;
  result_total_questions: number | null;
  assignment_title: string | null;
  classroom_name: string | null;
  classroom_id: number | null;
  assignment_id: number | null;
  has_feedback: boolean;
};

export type SubmissionQueue = {
  count: number;
  items: SubmissionQueueItem[];
};

/**
 * Student assessments surface: attempt lifecycle + results.
 * Shapes match `backend/openapi.yaml` (see `npm run gen:openapi`).
 */
export const assessmentsStudentApi = {
  start: async (payload: AttemptStartRequest & { focus_question_ids?: number[] }): Promise<Attempt> => {
    const r = await api.post("/assessments/attempts/start/", payload);
    return r.data as Attempt;
  },
  bundle: async (attemptId: number): Promise<AssessmentAttemptBundleResponse> => {
    const r = await api.get(`/assessments/attempts/${attemptId}/bundle/`);
    return r.data as AssessmentAttemptBundleResponse;
  },
  saveAnswer: async (payload: AttemptAnswerRequest): Promise<SaveAnswerResponse> => {
    const r = await api.post("/assessments/attempts/answer/", payload);
    return r.data as SaveAnswerResponse;
  },
  submit: async (payload: AttemptSubmitRequest): Promise<SubmitResponse> => {
    const r = await api.post("/assessments/attempts/submit/", payload);
    return r.data as SubmitResponse;
  },
  myResult: async (assignmentId: number): Promise<AssessmentMyResultResponse> => {
    const r = await api.get(`/assessments/homework/${assignmentId}/my-result/`);
    return r.data as AssessmentMyResultResponse;
  },
  /** Post-submission pedagogical review: questions WITH correct_answer + explanation + student answers. */
  pedagogicalReview: async (attemptId: number): Promise<PedagogicalReviewBundle> => {
    const r = await api.get(`/assessments/attempts/${attemptId}/review/`);
    return r.data as PedagogicalReviewBundle;
  },
  /** Get teacher feedback on an attempt (accessible by student post-submission or teacher). */
  getFeedback: async (attemptId: number): Promise<TeacherFeedback | null> => {
    const r = await api.get(`/assessments/attempts/${attemptId}/feedback/`);
    const data = r.data as { feedback: TeacherFeedback | null };
    return data.feedback;
  },
};

// ─── Teacher-facing API ────────────────────────────────────────────────────────

export const assessmentsTeacherApi = {
  /** Post or update feedback on a student's attempt. */
  setFeedback: async (attemptId: number, body: string): Promise<TeacherFeedback> => {
    const r = await api.post(`/assessments/attempts/${attemptId}/feedback/`, { body });
    const data = r.data as { feedback: TeacherFeedback };
    return data.feedback;
  },
  /** Delete feedback from an attempt. */
  deleteFeedback: async (attemptId: number): Promise<void> => {
    await api.delete(`/assessments/attempts/${attemptId}/feedback/`);
  },
  /** Submission queue: all submitted/graded attempts for teacher's classrooms. */
  submissionQueue: async (params?: {
    classroom_id?: number;
    status?: "submitted" | "graded" | "all";
    limit?: number;
    offset?: number;
  }): Promise<SubmissionQueue> => {
    const r = await api.get("/assessments/teacher/submission-queue/", { params });
    return r.data as SubmissionQueue;
  },
};
