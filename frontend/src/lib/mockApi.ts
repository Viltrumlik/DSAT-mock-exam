/**
 * Client for the separated full-mock system (/api/mocks/*). The runner drives the attempt
 * via the shared exam-runner client (mockExamApi); this covers the list, create, the
 * between-sections break (end_break), and the 1600 results.
 */
import api from "@/lib/api";

export interface MockRow {
  mock_id: number;
  title: string;
  break_minutes: number;
  module_count: number;
  attempt_id: number | null;
  state: string;
  in_progress: boolean;
  submitted: boolean;
  total_score: number | null;
  /** The last FINISHED sitting — where "View result" points, even during a retake. */
  result_attempt_id: number | null;
}

export interface MockResult {
  mock_kind: string;
  title: string;
  english_score: number | null;
  math_score: number | null;
  total_score: number | null;
  score_ceiling: number;
}

/** A place in an invigilated sitting, as the student sees it. Never carries the code. */
export interface MockSessionPlace {
  session_id: number;
  mock_id: number;
  title: string;
  session_date: string;
  /** OPEN | STARTED | ENDED */
  status: string;
  /** PENDING | APPROVED | REJECTED */
  my_status: string;
  requested_at: string | null;
  /** Non-null the instant the room starts — this is what the waiting room watches for. */
  attempt_id: number | null;
  started_at: string | null;
}

export const mockApi = {
  async myMocks(): Promise<MockRow[]> {
    const r = await api.get("/mocks/mine/");
    return r.data?.results ?? [];
  },
  /** Create-or-resume a mock attempt; returns the attempt id. */
  async createAttempt(mockId: number): Promise<number> {
    const r = await api.post("/mocks/attempts/", { mock: mockId });
    return r.data.id as number;
  },
  /** Proceed from the break to the Math section. */
  async endBreak(attemptId: number) {
    const r = await api.post(`/mocks/attempts/${attemptId}/end_break/`, {});
    return r.data;
  },
  async getResults(attemptId: number): Promise<MockResult> {
    const r = await api.get(`/mocks/attempts/${attemptId}/results/`);
    return r.data as MockResult;
  },

  // ── invigilated sittings ──
  /** Type the code the teacher read out; join the approval queue. */
  async joinSession(code: string): Promise<MockSessionPlace> {
    const r = await api.post("/mocks/sessions/join/", { code });
    return r.data as MockSessionPlace;
  },
  /** Every sitting this student has a place in. The waiting room polls this. */
  async mySessions(): Promise<MockSessionPlace[]> {
    const r = await api.get("/mocks/sessions/mine/");
    return r.data?.results ?? [];
  },
};
