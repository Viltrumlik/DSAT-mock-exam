import api, { getCachedCsrfToken } from "@/lib/api";

import type { components } from "@/lib/openapi-types";
import type { AttemptAnswerRequest, AttemptSubmitRequest, Attempt } from "@/features/assessments/types";
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
  // Figures (relative media paths; resolve against API origin before rendering)
  question_image?: string | null;
  option_a_image?: string | null;
  option_b_image?: string | null;
  option_c_image?: string | null;
  option_d_image?: string | null;
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
  start: async (
    payload: { assignment_id?: number; homework_id?: number; focus_question_ids?: number[] },
  ): Promise<Attempt> => {
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
  /**
   * Fire-and-forget answer save that survives a tab close / navigation
   * (`keepalive`). Used to drain any answer still sitting in the client's
   * debounce buffer the moment the student leaves, so a just-picked answer can
   * never be lost (end up "omitted"). Regular autosave persists it too — this is
   * the last-ditch guarantee for the sub-debounce window.
   */
  saveAnswerKeepalive: (attemptId: number, questionId: number, answer: unknown, currentIndex?: number): void => {
    try {
      const token = getCachedCsrfToken();
      void fetch("/api/assessments/attempts/answer/", {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-CSRFToken": token } : {}),
        },
        body: JSON.stringify({
          attempt_id: attemptId,
          question_id: questionId,
          answer,
          ...(currentIndex != null ? { current_index: currentIndex } : {}),
        }),
      });
    } catch {
      /* best-effort — the answer is also autosaved + mirrored to local storage */
    }
  },
  submit: async (payload: AttemptSubmitRequest): Promise<SubmitResponse> => {
    const r = await api.post("/assessments/attempts/submit/", payload);
    return r.data as SubmitResponse;
  },
  /**
   * Pause (save-and-exit / auto-pause): freezes the elapsed time-on-task counter
   * and records the last-viewed question so the attempt resumes in place. The
   * attempt stays in progress and fully resumable. Returns the updated attempt.
   */
  pause: async (payload: { attempt_id: number; current_index?: number }): Promise<Attempt> => {
    const r = await api.post("/assessments/attempts/pause/", payload);
    return r.data as Attempt;
  },
  /** Resume a paused attempt — the elapsed counter continues from where it froze. */
  resume: async (payload: { attempt_id: number }): Promise<Attempt> => {
    const r = await api.post("/assessments/attempts/resume/", payload);
    return r.data as Attempt;
  },
  /**
   * Fire-and-forget pause that survives a tab close / navigation (`keepalive`).
   * Used for auto-pause on tab-hide / page-hide so the POST still lands as the
   * page is torn down. Answers are autosaved separately, so this only persists
   * pause state + the question cursor. Best-effort: failures are swallowed.
   */
  pauseKeepalive: (attemptId: number, currentIndex?: number): void => {
    try {
      const token = getCachedCsrfToken();
      void fetch("/api/assessments/attempts/pause/", {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-CSRFToken": token } : {}),
        },
        body: JSON.stringify({
          attempt_id: attemptId,
          ...(currentIndex != null ? { current_index: currentIndex } : {}),
        }),
      });
    } catch {
      /* best-effort: progress is also continuously autosaved */
    }
  },
  myResult: async (assignmentId: number): Promise<AssessmentMyResultResponse> => {
    const r = await api.get(`/assessments/homework/${assignmentId}/my-result/`);
    return r.data as AssessmentMyResultResponse;
  },
  /** Result for ONE assessment homework — unambiguous when a homework bundles several. */
  myResultByHomework: async (homeworkId: number): Promise<AssessmentMyResultResponse> => {
    const r = await api.get(`/assessments/homework/by-homework/${homeworkId}/my-result/`);
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
