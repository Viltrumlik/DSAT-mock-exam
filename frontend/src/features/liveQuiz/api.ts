/**
 * REST client for live quizzes.
 *
 * Only the things that are not the game itself live here: making a room, finding one by
 * code, listing, and reading the results afterwards. Everything that has to arrive the
 * instant it happens comes down the socket (`socket.ts`).
 *
 * Rows are spread, never rebuilt field by field — a hand-written whitelist here is a second
 * copy of the contract that nothing checks, and it is how fields have gone missing before.
 */

import api from "@/lib/api";

export type LiveQuizStatus =
  | "LOBBY"
  | "STARTING"
  | "QUESTION_ACTIVE"
  | "QUESTION_RESULTS"
  | "PAUSED"
  | "FINISHED"
  | "TERMINATED";

export const LIVE_STATUSES: LiveQuizStatus[] = [
  "LOBBY",
  "STARTING",
  "QUESTION_ACTIVE",
  "QUESTION_RESULTS",
  "PAUSED",
];

export interface LiveQuizConfig {
  question_seconds: number;
  speed_bonus_ratio: number;
  allow_answer_change: boolean;
  show_leaderboard_between: boolean;
  reveal_correctness: boolean;
  shuffle_questions: boolean;
  shuffle_choices: boolean;
  manual_advance: boolean;
}

export interface LiveSession {
  id: number;
  /** Absent on the student's "running now" list — a list of live codes is a leak. */
  join_code?: string;
  status: LiveQuizStatus;
  classroom_id: number;
  classroom_name: string;
  assessment_set_id: number;
  title: string;
  host_id: number | null;
  current_index: number;
  question_total: number | null;
  config: LiveQuizConfig;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  counts: { participants?: number; present?: number };
}

export interface LiveParticipant {
  id: number;
  user_id: number;
  display_name: string;
  status: "JOINED" | "LEFT" | "KICKED";
  present: boolean;
  score: number;
  correct_count: number;
  answered_count: number;
  rank: number | null;
}

export interface LiveChoice {
  id: string;
  text: string;
}

/** What a player is allowed to see. There is deliberately no `correct_answer` here. */
export interface LiveQuestion {
  id: number;
  index: number;
  total: number;
  prompt: string;
  question_prompt: string;
  question_type: "multiple_choice" | "numeric" | "short_text" | "boolean";
  choices: LiveChoice[];
  points: number;
  time_limit_seconds: number;
  question_image: string | null;
  option_a_image: string | null;
  option_b_image: string | null;
  option_c_image: string | null;
  option_d_image: string | null;
}

export interface LiveQuizOption {
  id: number;
  title: string;
  subject: string;
  level: string;
  category: string;
  question_count: number;
  review_status: string;
  is_approved: boolean;
}

export interface LiveResultsReport {
  participants: Array<{
    participant_id: number;
    user_id: number;
    display_name: string;
    score: number;
    rank: number | null;
    correct_count: number;
    answered_count: number;
    answers: Array<{
      question_id: number;
      order: number;
      answered: boolean;
      is_correct: boolean;
      points_awarded: number;
      response_time_ms: number | null;
    }>;
  }>;
  questions: Array<{
    question_id: number;
    order: number;
    prompt: string;
    correct_answer: unknown;
    answered: number;
    correct: number;
    by_choice: Record<string, number>;
  }>;
}

export const liveQuizApi = {
  async listSessions(params: { classroom?: number; live?: boolean } = {}): Promise<LiveSession[]> {
    const { data } = await api.get("/livequiz/sessions/", {
      params: {
        ...(params.classroom ? { classroom: params.classroom } : {}),
        ...(params.live ? { live: 1 } : {}),
      },
    });
    return (data?.results ?? []) as LiveSession[];
  },

  async createSession(body: {
    classroom_id: number;
    assessment_set_id: number;
    config?: Partial<LiveQuizConfig>;
  }): Promise<LiveSession> {
    const { data } = await api.post("/livequiz/sessions/", body);
    return data as LiveSession;
  },

  async session(id: number): Promise<LiveSession> {
    const { data } = await api.get(`/livequiz/sessions/${id}/`);
    return data as LiveSession;
  },

  async terminate(id: number): Promise<LiveSession> {
    const { data } = await api.post(`/livequiz/sessions/${id}/terminate/`, {});
    return data as LiveSession;
  },

  async results(id: number): Promise<{ session: LiveSession; report: LiveResultsReport }> {
    const { data } = await api.get(`/livequiz/sessions/${id}/results/`);
    return data;
  },

  async join(
    code: string,
  ): Promise<{
    session: LiveSession;
    participant: { id: number; display_name: string; score: number };
  }> {
    const { data } = await api.post("/livequiz/join/", { code: code.trim().toUpperCase() });
    return data;
  },

  async mine(): Promise<LiveSession[]> {
    const { data } = await api.get("/livequiz/mine/");
    return (data?.results ?? []) as LiveSession[];
  },

  async options(classroomId: number): Promise<{
    classroom: { id: number; name: string; level: string };
    assessment_sets: LiveQuizOption[];
  }> {
    const { data } = await api.get("/livequiz/options/", { params: { classroom: classroomId } });
    return data;
  },
};
