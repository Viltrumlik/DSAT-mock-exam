// Journal Management types — mirror the backend `journals` serializers.

export type JournalStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type LessonType = "HOMEWORK" | "MIDTERM";
export type LessonStatus = "DRAFT" | "PUBLISHED";
export type PracticeScope = "BOTH" | "ENGLISH" | "MATH";

export type JournalProgress = {
  sessions_total: number;
  sessions_ready: number;
  sessions_missing: number;
  homework_total: number;
  homework_ready: number;
  homework_missing: number;
  classwork_ready: number;
  classwork_missing: number;
  midterm_total: number;
  midterm_count: number;
  midterm_configured: number;
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

/** Advisory shape only — the admin decides the real session/midterm counts. */
export type JournalRecommendation = {
  months: number;
  lessons: number;
  midterms: number;
  midterm_every: number;
};

export type LessonMidterm = {
  exam_id: number | null;
  title: string;
  subject?: string;
  level?: string;
  scoring_scale?: string;
  duration_minutes?: number | null;
  access_days_before: number;
};

export type LessonSummary = {
  id: number;
  lesson_number: number;
  lesson_type: LessonType;
  status: LessonStatus;
  title: string;
  content_count: number;
  is_ready: boolean;
  homework_ready: boolean;
  classwork_ready: boolean;
  validation: string[];
  homework_validation: string[];
  classwork_validation: string[];
  has_files: boolean;
  has_assessment: boolean;
  has_pastpaper: boolean;
  midterm: LessonMidterm | null;
  new_topic_title: string;
  updated_at: string;
  created_at: string;
};

export type JournalDetail = JournalListItem & {
  recommended: JournalRecommendation | null;
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

/** One row of the reminder timetable shown above the classwork. */
export type TimetableBlock = { key: string; label: string; minutes: number };

/** The previous session's homework, surfaced for in-class analysis (derived, not authored). */
export type HomeworkReview = {
  lesson_id: number;
  lesson_number: number;
  title: string;
  instructions: string;
  external_url: string;
  assessments: LessonAssessment[];
  practice_test_ids: number[];
  practice_test_pack_ids: number[];
  attachment_urls: LessonAttachment[];
  allow_file_upload: boolean;
};

export type Classwork = {
  id: number;
  timetable: TimetableBlock[];
  total_minutes: number;

  homework_review_minutes: number;
  new_topic_minutes: number;
  break_minutes: number;
  exercises_minutes: number;
  revision_minutes: number;

  new_topic_title: string;
  new_topic_instructions: string;
  new_topic_external_url: string;
  new_topic_practice_test_ids: number[];
  new_topic_practice_test_pack_ids: number[];
  new_topic_assessments: LessonAssessment[];
  new_topic_attachment_urls: LessonAttachment[];

  exercise_practice_test_ids: number[];
  exercise_practice_test_pack_ids: number[];
  exercise_assessments: LessonAssessment[];

  revision_notes: string;
  revision_targets: {
    assessments: LessonAssessment[];
    practice_test_ids: number[];
    practice_test_pack_ids: number[];
  };

  homework_review: HomeworkReview | null;

  is_ready: boolean;
  validation: string[];
};

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
  assessments: LessonAssessment[];
  attachment_urls: LessonAttachment[];
  midterm: LessonMidterm | null;
  classwork: Classwork | null;
  content_count: number;
  is_ready: boolean;
  homework_ready: boolean;
  classwork_ready: boolean;
  validation: string[];
  homework_validation: string[];
  classwork_validation: string[];
  created_at: string;
  updated_at: string;
};

export type MidtermOption = {
  id: number;
  title: string;
  subject: string;
  level: string;
  scoring_scale: string;
  duration_minutes: number | null;
  question_count: number | null;
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
