/**
 * Vocabulary DTOs — the single source of truth for both the student hub and the
 * study modes. Mirrors `backend/vocabulary/serializers.py`.
 */

export type WordStatus = "new" | "learning" | "mastered";

export type StudyMode = "flashcard" | "matching" | "speed" | "test";

export const STUDY_MODES: StudyMode[] = ["flashcard", "matching", "speed", "test"];

/** The All/New/Learning/Mastered control on a set's word list. */
export type WordFilter = "all" | WordStatus;

export interface ProgressCounts {
  new: number;
  learning: number;
  mastered: number;
  total: number;
}

export interface VocabWord {
  id: number;
  word: string;
  definition: string;
  part_of_speech: string;
  example: string;
  synonyms: string[];
  status: WordStatus;
}

/** A bank word as returned by the search endpoint that feeds the custom-set builder. */
export interface VocabWordSearchResult {
  id: number;
  word: string;
  definition: string;
  part_of_speech: string;
  section_id: number;
  section_title: string;
}

export interface VocabSectionSummary {
  id: number;
  title: string;
  slug: string;
  description: string;
  set_count: number;
  word_count: number;
  progress: ProgressCounts;
}

export interface VocabSetSummary {
  id: number;
  title: string;
  order: number;
  word_count: number;
  completed: boolean;
  progress: ProgressCounts;
}

export interface VocabSectionDetail {
  id: number;
  title: string;
  slug: string;
  description: string;
  sets: VocabSetSummary[];
}

export interface VocabSetDetail {
  id: number;
  title: string;
  is_custom: boolean;
  section: { id: number; title: string } | null;
  word_count: number;
  completed: boolean;
  words: VocabWord[];
}

export interface CustomSetSummary {
  id: number;
  title: string;
  word_count: number;
  completed: boolean;
  created_at: string;
}

export interface VocabHomeworkSet {
  id: number;
  title: string;
  section_title: string;
  word_count: number;
  completed: boolean;
}

export interface VocabHomeworkGroup {
  assignment_id: number;
  assignment_title: string;
  classroom_id: number;
  classroom_name: string;
  due_at: string | null;
  sets: VocabHomeworkSet[];
}

export interface StudySession {
  id: number;
  set_id: number;
  mode: StudyMode;
  started_at: string;
}

/** One graded answer. Modes push these in the order the student answered. */
export interface SessionResult {
  word_id: number;
  correct: boolean;
}

export interface SessionSummary {
  id: number;
  mode: StudyMode;
  correct_count: number;
  total_count: number;
  accuracy: number;
  duration_ms: number;
  /** True once ANY one mode has been finished for this set — the completion rule. */
  set_completed: boolean;
  progress: ProgressCounts;
}

export const WORD_STATUS_LABEL: Record<WordStatus, string> = {
  new: "New",
  learning: "Learning",
  mastered: "Mastered",
};

export const STUDY_MODE_LABEL: Record<StudyMode, string> = {
  flashcard: "Flashcard",
  matching: "Matching",
  speed: "Speed",
  test: "Test",
};
