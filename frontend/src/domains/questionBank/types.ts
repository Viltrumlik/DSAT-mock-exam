/**
 * Domain types: Question Bank (admin).
 * Mirror the read-only + triage/import REST API at /api/questionbank/.
 */
export type QbSubject = "ENGLISH" | "MATH";
export type QbStatus = "IMPORTED" | "TRIAGE" | "APPROVED" | "REJECTED" | "ARCHIVED";
export type QbDifficulty = "EASY" | "MEDIUM" | "HARD" | "";
export type QbQuestionType =
  | "MULTIPLE_CHOICE"
  | "STUDENT_PRODUCED"
  | "SHORT_TEXT"
  | "NUMERIC"
  | "BOOLEAN";
export type QbValidation = "VALID" | "WARNING" | "ERROR" | "DUPLICATE";

export type QbSuggestion = {
  advisory: true;
  domain: { id: number; name: string } | null;
  skill: { id: number; name: string } | null;
  difficulty: string | null;
  confidence: number | null;
  model?: string | null;
  rationale?: string | null;
};

export type QbDomain = {
  id: number;
  subject: QbSubject;
  name: string;
  code: string;
  display_order: number;
};

export type QbSkill = {
  id: number;
  domain: number;
  domain_name: string;
  subject: QbSubject;
  name: string;
  code: string;
  display_order: number;
};

export type QbQuestionListItem = {
  id: number;
  qb_id: string;
  external_id: string;
  subject: QbSubject;
  status: QbStatus;
  question_type: QbQuestionType;
  difficulty: QbDifficulty;
  domain: number | null;
  domain_name: string | null;
  skill: number | null;
  skill_name: string | null;
  question_text: string;
  passage: number | null;
  has_image: boolean;
  source_type: string;
  content_hash: string;
  import_batch: number | null;
  suggestion: QbSuggestion | null;
  created_at: string;
  updated_at: string;
};

export type QbPassage = {
  id: number;
  subject: QbSubject;
  passage_text: string;
  content_hash: string;
  source_type: string;
  source_reference: string;
  import_batch: number | null;
  metadata: Record<string, unknown>;
  question_count: number;
  created_at: string;
  updated_at: string;
};

export type QbQuestionDetail = {
  id: number;
  qb_id: string;
  external_id: string;
  subject: QbSubject;
  status: QbStatus;
  question_type: QbQuestionType;
  difficulty: QbDifficulty;
  domain: QbDomain | null;
  skill: QbSkill | null;
  passage: QbPassage | null;
  question_text: string;
  question_prompt: string;
  question_image: string | null;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_a_image: string | null;
  option_b_image: string | null;
  option_c_image: string | null;
  option_d_image: string | null;
  correct_answer: unknown;
  student_answer: unknown;
  explanation: string;
  points: number;
  content_hash: string;
  source_type: string;
  source_reference: string;
  import_batch: number | null;
  suggestion: QbSuggestion | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type QbImportBatch = {
  id: number;
  source_type: string;
  filename: string;
  source_reference: string;
  status: string;
  status_display: string;
  total_candidates: number;
  promoted_count: number;
  candidate_counts: { valid: number; warning: number; error: number; duplicate: number };
  notes: string;
  created_at: string;
  updated_at: string;
};

export type QbImportCandidate = {
  id: number;
  batch: number;
  order: number;
  subject: string;
  raw_domain: string;
  raw_skill: string;
  raw_difficulty: string;
  passage_text: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: unknown;
  explanation: string;
  content_hash: string;
  page_start: number | null;
  page_end: number | null;
  validation_status: QbValidation;
  validation_messages: string[];
  duplicate_of: number | null;
  duplicate_of_qb_id: string | null;
  promoted_question: number | null;
  promoted_question_qb_id: string | null;
  created_at: string;
};

export type QbPaginated<T> = {
  count: number;
  results: T[];
  next: string | null;
  previous: string | null;
};

export type QbQuestionFilters = {
  subject?: string;
  status?: string;
  difficulty?: string;
  source?: string;
  domain?: number;
  skill?: number;
  import_batch?: number;
  search?: string;
  limit?: number;
  offset?: number;
};

export type QbWritePayload = {
  subject?: string;
  question_type?: string;
  difficulty?: string;
  external_id?: string;
  domain?: number | null;
  skill?: number | null;
  question_text?: string;
  question_prompt?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct_answer?: string;
  student_answer?: string;
  explanation?: string;
  points?: number;
};

export type QbImageKey = "question" | "a" | "b" | "c" | "d";
export type QbImageFiles = Partial<Record<QbImageKey, File>>;
export type QbClearImages = Partial<Record<QbImageKey, boolean>>;

export type QbClassifyInput = { domain: number; skill: number; difficulty: string };
export type QbBulkAction = "approve" | "reject" | "classify";
export type QbBulkInput = {
  action: QbBulkAction;
  ids: number[];
  domain?: number;
  skill?: number;
  difficulty?: string;
  reason?: string;
};
export type QbBulkResult = { id: number; ok: boolean; status?: string; error?: string };
