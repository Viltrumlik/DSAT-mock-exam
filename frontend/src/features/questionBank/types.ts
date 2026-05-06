export type AdminCategory = {
  id: number;
  name: string;
  subject: string | null;
};

/** Standalone authoring lifecycle — must be approved (+ active) before module assignment */
export type QuestionLifecycleStatus = "draft" | "review" | "approved" | "archived";

export type AdminStandaloneQuestion = {
  id: number;
  question_type: string;
  question_text: string;
  question_prompt: string;
  explanation: string;
  is_active: boolean;
  status?: QuestionLifecycleStatus;
  review_comment?: string;
  /** Module link count — warn when editing heavily used rows */
  usage_count?: number;
  created_at?: string;
  updated_at?: string;
  created_by?: { id: number; email: string } | null;
  updated_by?: { id: number; email: string } | null;
  order: number | null;
  module_id?: number | null;
  practice_test_id?: number | null;
  category?: number | null;
  correct_answer?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  is_math_input?: boolean;
  score?: number;
};

export type QuestionModuleLink = {
  module_question_id: number;
  module_id: number;
  module_order: number;
  practice_test_id: number;
  practice_test_title: string;
  subject: string | null;
};

export type SubjectFilter = "all" | "MATH" | "READING_WRITING";
export type ActiveFilter = "all" | "1" | "0";
export type LifecycleStatusFilter = "all" | QuestionLifecycleStatus;
