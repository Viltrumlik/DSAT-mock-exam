import type { components } from "@/lib/openapi-types";

export type Subject = "math" | "english";

export type AssessmentSet = {
  id: number;
  subject: Subject;
  /** Provenance of the questions; see lib/assessmentSources. Blank on legacy sets. */
  source?: string;
  /** Difficulty tier; see lib/levels. Blank on legacy/untagged sets. */
  level?: string;
  category: string;
  title: string;
  description: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  questions?: AssessmentQuestion[];
  // Optional backend fields (some serializers include them)
  status?: "draft" | "published" | string;
};

export type AssessmentQuestionType = "multiple_choice" | "numeric" | "short_text" | "boolean";

export type AssessmentChoice = { id: string; text: string };

export type AssessmentQuestion = {
  id: number;
  assessment_set: number;
  order: number;
  prompt: string;
  question_prompt?: string;
  question_type: AssessmentQuestionType;
  choices: AssessmentChoice[] | any[];
  correct_answer?: any;
  grading_config?: Record<string, unknown>;
  points: number;
  is_active: boolean;
  explanation?: string;
  question_image?: string | null;
  option_a_image?: string | null;
  option_b_image?: string | null;
  option_c_image?: string | null;
  option_d_image?: string | null;
};

export type HomeworkAssignmentCreateRequest = {
  classroom_id: number;
  set_id: number;
  title?: string;
  instructions?: string;
  due_at?: string | null;
};

export type AttemptStartRequest = { assignment_id: number };
export type AttemptAnswerRequest = components["schemas"]["SaveAnswer"];

export type AttemptSubmitRequest = { attempt_id: number };

/** Assessments `/attempts/start/` / bundle / submit payload attempt (OpenAPI `AssessmentAttempt`). */
export type Attempt = components["schemas"]["AssessmentAttempt"];

