// Journal Management types — mirror the backend `journals` serializers.

export type JournalStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type LessonType = "HOMEWORK" | "MIDTERM";
export type LessonStatus = "DRAFT" | "PUBLISHED";
export type PracticeScope = "BOTH" | "ENGLISH" | "MATH";

export type JournalProgress = {
  homework_total: number;
  homework_ready: number;
  homework_missing: number;
  midterm_total: number;
  midterm_count: number;
  draft_count: number;
  published_count: number;
  completion_pct: number;
};

export type JournalListItem = {
  id: number;
  subject: string; // "ENGLISH" | "MATH"
  subject_label: string;
  level: string; // foundation/junior/middle/senior
  level_label: string;
  title: string;
  display_title: string;
  status: JournalStatus;
  duration_months: number;
  total_lessons: number;
  version: number;
  last_updated: string;
  progress: JournalProgress;
};

export type LessonSummary = {
  id: number;
  lesson_number: number;
  lesson_type: LessonType;
  status: LessonStatus;
  title: string;
  content_count: number;
  is_ready: boolean;
  validation: string[];
  has_files: boolean;
  has_assessment: boolean;
  has_pastpaper: boolean;
  due_after_days: number | null;
  updated_at: string;
  created_at: string;
};

export type JournalDetail = JournalListItem & {
  created_at: string;
  updated_at: string;
  published_at: string | null;
  archived_at: string | null;
  lessons: LessonSummary[];
};

export type LessonAssessment = {
  id: number;
  assessment_set_id: number;
  title: string;
  subject: string;
  level: string;
  source: string;
};

export type LessonAttachment = { id: number | null; name: string; url: string };

export type LessonDetail = {
  id: number;
  journal_id: number;
  lesson_number: number;
  lesson_type: LessonType;
  status: LessonStatus;
  title: string;
  instructions: string;
  external_url: string;
  allow_file_upload: boolean;
  practice_scope: PracticeScope;
  practice_test_ids: number[];
  practice_test_pack_ids: number[];
  category: string;
  max_score: string | null;
  due_after_days: number | null;
  deadline_time: string | null;
  assessments: LessonAssessment[];
  attachment_urls: LessonAttachment[];
  content_count: number;
  is_ready: boolean;
  validation: string[];
  created_at: string;
  updated_at: string;
};

export type ContentOptions = {
  subject: string;
  level: string;
  practice_tests: Array<Record<string, unknown> & { id: number; already_assigned?: boolean }>;
  assessment_sets: Array<{
    id: number;
    title: string;
    subject: string;
    source?: string;
    level?: string;
    category: string;
    description: string;
    question_count: number;
    already_assigned?: boolean;
  }>;
  practice_test_packs: Array<{
    id: number;
    title: string;
    description: string;
    section_count: number;
    already_assigned?: boolean;
  }>;
};
