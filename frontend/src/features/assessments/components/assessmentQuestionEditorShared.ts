import type { AssessmentQuestionType } from "@/features/assessments/types";

export type AssessmentQuestionEditorDraft = {
  prompt: string;
  question_prompt: string;
  question_type: AssessmentQuestionType;
  order: number;
  points: number;
  is_active: boolean;
  explanation: string;
  choicesText: string;
  correctAnswerText: string;
  gradingConfigText: string;
};

export type AssessmentImageKey = "question" | "a" | "b" | "c" | "d";

export type AssessmentImageState = {
  files: Partial<Record<AssessmentImageKey, File>>;
  clears: Partial<Record<AssessmentImageKey, boolean>>;
};

export function parseJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
