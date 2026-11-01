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
  manual_advance: boolean;
  /** Absent on rooms created before modes existed — those are teacher-paced. */
  mode?: LiveQuizMode;
  shuffle_answers?: boolean;
  show_answers?: boolean;
  powerups?: boolean;
  point_scale?: number;
}

export type LiveQuizMode = "student_paced" | "instructor_paced";

export type PowerUpKey = "double" | "fifty_fifty" | "eraser" | "streak_saver" | "time_freeze";

/** One square on the host's live dashboard: how one student did on one question. */
export interface BoardCell {
  /** The question's place in the paper — a column means the same question for everyone. */
  order: number;
  correct: boolean;
  timed_out: boolean;
  points: number;
}

export interface LiveSession {
  id: number;
  /** Absent on the student's "running now" list — a list of live codes is a leak. */
  join_code?: string;
  status: LiveQuizStatus;
  classroom_id: number;
  classroom_name: string;
  vocab_set_id: number;
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
  streak?: number;
  best_streak?: number;
  /** Student-paced: questions behind them, and whether that was the last one. */
  progress?: number;
  finished?: boolean;
  /** Only on your own row. */
  powerups?: PowerUpKey[];
  question_total?: number;
  /** The avatar they wear; null draws their initials. */
  avatar?: AvatarWire | null;
}

export interface AvatarWire {
  character: string;
  skin: AvatarSkin | null;
}

export type AvatarSkin = "rare" | "epic" | "legendary";

export interface ShopItem {
  key: string;
  kind: "character" | "skin";
  character: string;
  tier: "common" | "rare" | "epic" | "legendary";
  name: string;
  price: number;
  starter: boolean;
  owned: boolean;
}

export interface ShopState {
  balance: number;
  today_earned: number;
  daily_cap: number;
  can_claim_starter: boolean;
  starters: string[];
  look: AvatarWire | null;
  items: ShopItem[];
}

export interface LiveChoice {
  id: string;
  text: string;
}

/**
 * What a player is allowed to see. There is deliberately no `correct_answer` here.
 *
 * `form` says which way round the question was asked — the definition with the words as
 * options, or the word with the definitions.
 */
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
  form: "definition_to_word" | "word_to_definition" | "";
}

export interface LiveQuizOption {
  id: number;
  title: string;
  /** The bank section the set belongs to, e.g. "Real Exam Words". */
  section: string;
  word_count: number;
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
    best_streak?: number;
    /** Gems this game paid them. */
    gems?: number;
    /** Out of the questions they actually met; null when they met none. */
    accuracy?: number | null;
    answers: Array<{
      question_id: number;
      order: number;
      answered: boolean;
      timed_out?: boolean;
      answer?: unknown;
      is_correct: boolean;
      points_awarded: number;
      response_time_ms: number | null;
    }>;
  }>;
  questions: Array<{
    question_id: number;
    order: number;
    prompt: string;
    question_prompt?: string;
    form?: LiveQuestion["form"];
    choices?: LiveChoice[];
    correct_answer: unknown;
    explanation?: string;
    answered: number;
    correct: number;
    missed?: number;
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
    vocab_set_id: number;
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

  /** Take a place in a room reached by id — from `mine()`, a bookmark, or a refresh.
   *
   *  `mine()` strips the code out of every row, so the code cannot be the way in from there.
   *  The roster is the guard on both routes, and this reply carries no code either. Asking
   *  twice is safe: the server hands back the place you already had. */
  async joinSession(id: number): Promise<{
    session: LiveSession;
    participant: { id: number; display_name: string; score: number };
  }> {
    const { data } = await api.post(`/livequiz/sessions/${id}/join/`, {});
    return data;
  },

  async mine(): Promise<LiveSession[]> {
    const { data } = await api.get("/livequiz/mine/");
    return (data?.results ?? []) as LiveSession[];
  },

  async options(classroomId: number): Promise<{
    classroom: { id: number; name: string; level: string };
    vocab_sets: LiveQuizOption[];
  }> {
    const { data } = await api.get("/livequiz/options/", { params: { classroom: classroomId } });
    return data;
  },

  /** The gem shop. Every move answers with the whole shop again, so the page never has to
   *  work out a balance or an "owned" flag for itself. */
  async shop(): Promise<ShopState> {
    const { data } = await api.get("/livequiz/shop/");
    return data as ShopState;
  },

  async buy(item: string): Promise<ShopState> {
    const { data } = await api.post("/livequiz/shop/buy/", { item });
    return data as ShopState;
  },

  async claimStarter(character: string): Promise<ShopState> {
    const { data } = await api.post("/livequiz/shop/claim/", { character });
    return data as ShopState;
  },

  async equip(character: string, skin: AvatarSkin | null): Promise<ShopState> {
    const { data } = await api.post("/livequiz/shop/equip/", { character, skin });
    return data as ShopState;
  },
};
