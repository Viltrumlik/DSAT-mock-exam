import api from "@/lib/api";
import type { AssessmentQuestionType } from "@/features/assessments/types";

/**
 * The Question of the Day, as `backend/daily_questions` serves it.
 *
 * The question itself is the assessment runner's own safe shape: no answer key, no
 * explanation. Those two arrive only inside `result`, once the student has answered.
 */
export interface DailyQuestionContent {
  id: number;
  prompt: string;
  question_prompt: string;
  question_type: AssessmentQuestionType;
  choices: unknown;
  question_image: string | null;
  option_a_image: string | null;
  option_b_image: string | null;
  option_c_image: string | null;
  option_d_image: string | null;
}

export interface DailyQuestionReward {
  points: number;
  xp: number;
}

export interface DailyQuestionResult {
  answer: unknown;
  is_correct: boolean;
  correct_answer: unknown;
  explanation: string;
  /** What this answer actually earned — zero for a wrong one. */
  earned: DailyQuestionReward;
}

export interface DailyQuestion {
  id: number;
  date: string;
  subject: "english" | "math";
  level: string;
  status: "open" | "answered";
  question: DailyQuestionContent;
  result: DailyQuestionResult | null;
}

export interface DailyQuestionsToday {
  date: string;
  enabled: boolean;
  /** What right first time pays today. */
  reward: DailyQuestionReward;
  questions: DailyQuestion[];
}

export const dailyQuestionsApi = {
  async today(): Promise<DailyQuestionsToday> {
    const { data } = await api.get<DailyQuestionsToday>("/daily-questions/today/");
    // Spread, not rebuilt: a field the server adds later must not be dropped here.
    return { ...data, questions: data.questions ?? [] };
  },

  async answer(id: number, answer: unknown): Promise<DailyQuestion> {
    const { data } = await api.post<DailyQuestion>(`/daily-questions/${id}/answer/`, { answer });
    return data;
  },
};
