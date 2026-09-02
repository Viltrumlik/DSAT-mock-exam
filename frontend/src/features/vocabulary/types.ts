/**
 * Vocabulary DTOs — the single source of truth for both the student hub and the
 * study modes. Mirrors `backend/vocabulary/serializers.py`.
 */

/**
 * Two buckets, not three. A word is mastered once it has been answered correctly in ALL
 * FOUR games — the per-word form of the rule that masters the set — and until then it is
 * simply not mastered yet. The old middle bucket ("learning", three-correct-in-a-row) is
 * gone: it measured how warm a word was, which is a different question from whether the
 * student has proved it.
 */
export type WordStatus = "new" | "mastered";

export type StudyMode = "flashcard" | "matching" | "speed" | "test";

export const STUDY_MODES: StudyMode[] = ["flashcard", "matching", "speed", "test"];

/** The All/New/Mastered control on a set's word list. */
export type WordFilter = "all" | WordStatus;

export interface ProgressCounts {
  new: number;
  mastered: number;
  total: number;
}

/**
 * One set's progress bar: the four games, and which of them have been played CLEAN —
 * every word in the set answered, none of them wrong. Each one is a quarter of the bar,
 * and there is no partial credit inside a game.
 */
export interface SetMastery {
  modes: Record<StudyMode, boolean>;
  mastered_modes: number;
  total_modes: number;
  /** Whole games only: 0, 25, 50, 75 or 100. */
  percent: number;
  is_mastered: boolean;
}

/** A section's bar rolls up its sets, so it asks the same question one scale up. */
export interface SectionMastery {
  mastered_sets: number;
  total_sets: number;
  percent: number;
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
  mastery: SectionMastery;
}

export interface VocabSetSummary {
  id: number;
  title: string;
  order: number;
  word_count: number;
  /** True once ANY one game has been finished here — weaker than mastery, and not the bar. */
  completed: boolean;
  progress: ProgressCounts;
  mastery: SetMastery;
}

export interface VocabSectionDetail {
  id: number;
  title: string;
  slug: string;
  description: string;
  /**
   * DISTINCT words in the section — the same number the hub shows, and NOT the
   * sum of `sets[].word_count`: a word that belongs to two sets is one word here
   * and would be counted twice by that sum.
   */
  word_count: number;
  /** Section-level buckets over those distinct words. */
  progress: ProgressCounts;
  /** Derived from the very set cards below, so header and grid cannot disagree. */
  mastery: SectionMastery;
  sets: VocabSetSummary[];
}

export interface VocabSetDetail {
  id: number;
  title: string;
  is_custom: boolean;
  section: { id: number; title: string } | null;
  word_count: number;
  completed: boolean;
  mastery: SetMastery;
  words: VocabWord[];
}

export interface CustomSetSummary {
  id: number;
  title: string;
  word_count: number;
  completed: boolean;
  mastery: SetMastery;
  created_at: string;
}

export interface VocabHomeworkSet {
  id: number;
  title: string;
  section_title: string;
  word_count: number;
  completed: boolean;
  mastery: SetMastery;
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

/**
 * Body of `POST sessions/`.
 *
 * `assignment_id` is the classroom assignment the student launched this run
 * from — see `launchContext`. It is OPTIONAL in both directions: a run started
 * from the vocabulary hub or the question bank belongs to no homework, and the
 * server still accepts a body without it (every client shipped before this
 * field sent none).
 */
export interface SessionStartPayload {
  set_id: number;
  mode: StudyMode;
  assignment_id?: number;
}

/** One graded answer. Modes push these in the order the student answered. */
export interface SessionResult {
  word_id: number;
  correct: boolean;
}

/**
 * Body of `POST sessions/<id>/finish/`. The server APPENDS `results` to whatever
 * the session already holds, so a caller must send only what it has not sent
 * before — see `modes/useModeSession`.
 */
export interface SessionFinishPayload {
  duration_ms: number;
  results: SessionResult[];
  /**
   * True for an unload flush: record the answers WITHOUT stamping the session
   * complete, so quitting halfway can never satisfy the "any one mode completes
   * a set" rule. Absent means a completing finish.
   */
  partial?: boolean;
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
  /** Did THIS run master its game? A clean sweep: every word answered, none wrong. */
  mode_mastered: boolean;
  /** The set's four-game bar as it stands after this run. */
  mastery: SetMastery;
  progress: ProgressCounts;
}

export const WORD_STATUS_LABEL: Record<WordStatus, string> = {
  new: "New",
  mastered: "Mastered",
};

export const STUDY_MODE_LABEL: Record<StudyMode, string> = {
  flashcard: "Flashcard",
  matching: "Matching",
  speed: "Speed",
  test: "Test",
};
