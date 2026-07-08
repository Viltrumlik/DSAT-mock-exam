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
}

export interface MockResult {
  mock_kind: string;
  title: string;
  english_score: number | null;
  math_score: number | null;
  total_score: number | null;
  score_ceiling: number;
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
};
