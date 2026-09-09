/**
 * Wire types for the two item-analysis endpoints.
 *
 * Transcribed from the payload builders, not guessed:
 *   - `backend/assessments/item_analysis.py::build_item_analysis`
 *   - `backend/exams/pastpaper_item_analysis.py::build_pastpaper_item_analysis`
 *     (plus the `classroom` block `exams/views_item_analysis.py` bolts on afterwards)
 *
 * Two things these types are careful about, because the page's honesty rests on them:
 *
 * **Every rate is `number | null`.** The backend returns `None` — never `0.0` — whenever the
 * denominator is empty, and that distinction is the whole point: "nobody has answered this
 * yet" and "everybody got this right" are opposite facts. A `number` here would let a `??  0`
 * creep in somewhere and turn the first into the second.
 *
 * **The counts that qualify a rate are separate fields, not derived.** A past-paper row
 * carries `seen`/`answered`/`omitted`/`correct`/`wrong` because a blank answer is a pacing
 * problem and a wrong one is a teaching problem; an assessment row carries `ungraded` beside
 * `students_graded` because a rate over two verdicts is not the same fact as a rate over
 * twenty. None of them is reconstructable from the rate, so all of them are kept.
 */

// ── shared ───────────────────────────────────────────────────────────────────

/** A breakdown bucket key. `null` (past papers) / `"untagged"` (assessments) mean untagged. */
export type GroupKey = string | number | null;

// ── assessments ──────────────────────────────────────────────────────────────

export interface AssessmentSetRef {
  id: number;
  title: string;
  subject: string;
}

export interface AssessmentItemRow {
  question_id: number;
  /** Author-assigned ordering value; `position` is what a human counts. */
  order: number;
  /** 1-based position inside its own set. */
  position: number;
  prompt: string;
  prompt_truncated: boolean;
  question_type: string;
  question_type_label: string;
  set: AssessmentSetRef;
  /** Everyone who wrote something — includes answers still queued for grading. */
  students_answered: number;
  /** Everyone a verdict actually came back for. This is what `error_rate` divides by. */
  students_graded: number;
  students_correct: number;
  students_wrong: number;
  /** Answers with `is_correct = NULL`: submitted, not yet scored. Never counted as wrong. */
  ungraded: number;
  /** Percent of GRADED answers that were wrong. `null` when nothing is graded yet. */
  error_rate: number | null;
  needs_analysis: boolean;
  skill: string | null;
  domain: string | null;
}

export interface AssessmentGroupRow {
  key: GroupKey;
  label: string;
  questions: number;
  students_answered: number;
  students_graded: number;
  students_wrong: number;
  error_rate: number | null;
  needs_analysis_count: number;
}

/** How much of the classroom's content can be grouped by SAT skill, and why not, in words. */
export interface TaxonomyCoverage {
  linked: number;
  total: number;
  rate: number | null;
  /** Empty string when there is nothing to disclose. */
  note: string;
}

export interface AssessmentItemAnalysis {
  classroom: {
    id: number;
    name: string;
    subject: string;
    subject_label: string;
    level: string | null;
    level_label: string | null;
  };
  threshold: number;
  /** Always `"graded"` — stated by the server so the page never has to assume it. */
  denominator: string;
  counting_rule: string;
  summary: {
    questions_total: number;
    questions_analysed: number;
    questions_awaiting_grading: number;
    questions_flagged: number;
    students_counted: number;
    attempts_counted: number;
    sets: number;
  };
  taxonomy_coverage: TaxonomyCoverage;
  excluded: { retired_questions: number };
  /** The flagged rows, worst first. A subset of `questions`. */
  needs_analysis: AssessmentItemRow[];
  questions: AssessmentItemRow[];
  by_question_type: AssessmentGroupRow[];
  /** Empty when nothing is linked to the question bank — read `taxonomy_coverage.note`. */
  by_skill: AssessmentGroupRow[];
  by_domain: AssessmentGroupRow[];
  /** One entry per homework assignment, so the same set can appear twice. */
  sets: AssessmentSetRef[];
}

// ── past papers ──────────────────────────────────────────────────────────────

export interface PastpaperItemRow {
  question_id: number;
  /** Continuous across modules — Module 2's `order` restarts at 0, this does not. */
  number: number;
  module: number;
  module_label: string;
  stem: string;
  correct_answer: string;
  question_type: string;
  question_type_label: string;
  format: string;
  format_label: string;
  skill_id: number | null;
  /** Falls back to the literal "Untagged" — check `skill_id` for the real absence. */
  skill: string;
  domain_id: number | null;
  domain: string;
  difficulty: string | null;
  difficulty_label: string;
  /** Students who were shown the module this question sits in. */
  seen: number;
  /** Of those, the ones who wrote something. `error_rate` divides by this. */
  answered: number;
  /** Saw it, left it blank. A pacing signal, never folded into `wrong`. */
  omitted: number;
  correct: number;
  wrong: number;
  error_rate: number | null;
  /** `(wrong + omitted) / seen` — the pacing-aware reading of the same question. */
  miss_rate: number | null;
  needs_analysis: boolean;
  /** Error rate ≥ 90%: read the answer key before re-teaching anything. */
  suspect_key: boolean;
}

export interface PastpaperGroupRow {
  key: GroupKey;
  label: string;
  /** Every question in the group, the held-out ones included — nothing vanishes from a count. */
  questions: number;
  /**
   * Of those, the ones at 90%+ whose answer key is likelier broken than the topic is hard.
   * They are held out of `seen`/`answered`/`wrong`/`error_rate` below, because a breakdown row
   * is read as a statement about a topic and one broken key makes that statement false.
   */
  suspect_key_count: number;
  /** `questions - suspect_key_count`: the population every field under this one describes. */
  analysed_questions: number;
  seen: number;
  answered: number;
  wrong: number;
  /** `null` when every question in the group was held out — an em dash, never a 0%. */
  error_rate: number | null;
  /**
   * The teacher's work queue for this group, counted the other way round: suspect questions
   * are included, because a broken key is the first thing on it.
   */
  needs_analysis_count: number;
}

export interface PastpaperBreakdown {
  coverage: { tagged: number; total: number };
  groups: PastpaperGroupRow[];
}

export interface PastpaperItemAnalysis {
  practice_test: {
    id: number;
    title: string;
    collection_name: string;
    subject: string;
    subject_label: string;
  };
  /** Added by the view after the aggregation returns. */
  classroom: { id: number; name: string; subject: string; subject_label: string };
  threshold: number;
  /** Always `"answered"`. */
  denominator: string;
  /**
   * `"first_clean_completed_sitting_per_student"` — a machine tag, never rendered. "Clean",
   * not merely "first": a sitting carrying the July-2026 copy signature is discarded and the
   * student's *next* sitting is considered, rather than the student being dropped. The page
   * says this in the "Only one sitting counts" note, in words.
   */
  attempt_selection: string;
  needs_analysis: PastpaperItemRow[];
  questions: PastpaperItemRow[];
  totals: {
    /** The paper as recorded. These five are whole-paper tallies, suspect rows included. */
    questions: number;
    seen: number;
    answered: number;
    omitted: number;
    correct: number;
    wrong: number;
    /**
     * Read as a statement about the class, so it divides over `analysed`, NOT over the raw
     * tallies above it. `null` when every key on the paper is suspect.
     */
    error_rate: number | null;
    /**
     * Exactly what `error_rate` divided. Named in the payload so the rate and the raw tallies
     * beside it can never be mistaken for each other — they describe different populations
     * whenever the paper carries a suspect key.
     */
    analysed: { questions: number; seen: number; answered: number; wrong: number };
    needs_analysis: number;
    suspect_key: number;
  };
  /** The five breakdowns the owner asked for, in the order the page shows them. */
  groups: {
    question_type: PastpaperBreakdown;
    format: PastpaperBreakdown;
    skill: PastpaperBreakdown;
    domain: PastpaperBreakdown;
    difficulty: PastpaperBreakdown;
  };
  unclassified_total: number;
  unclassified_wrong: number;
  /** What was left out, and why. Never let the page imply it analysed excluded work. */
  data_quality: {
    roster: number;
    attempts_considered: number;
    attempts_counted: number;
    students_counted: number;
    excluded: {
      /** Module 2 answered under Module 1's ids — the pre-2026-07-21 submit bug. */
      copied: number;
      /** A second or third sitting of the same paper by the same student. */
      repeat_sitting: number;
    };
    suspect_key_questions: number;
  };
}

// ── pickers ──────────────────────────────────────────────────────────────────

/** The bits of `GET /exams/` the paper picker needs. */
export interface PastPaperOption {
  id: number;
  title?: string;
  collection_name?: string;
  subject: string;
}

/** The bits of `GET /classes/` the classroom picker needs. */
export interface ClassroomOption {
  id: number;
  name: string;
  subject: string;
  /** `false` means archived — still analysable, but labelled so nobody reads it as live. */
  is_active?: boolean;
  student_count?: number;
}

// ── inside one homework ──────────────────────────────────────────────────────

/**
 * Whether this homework's deadline has arrived.
 *
 * Decided by the SERVER, against `django.utils.timezone.now()`. The reader's laptop may be on
 * any date at all, and a client-side comparison is what would let a teacher on a wrong clock
 * — or a student on a borrowed staff login — pull the class's wrong answers and the answer
 * keys out of a homework that is still open.
 */
export type HomeworkState = "closed" | "open" | "no_deadline";

export interface HomeworkBlock {
  id: number;
  title: string;
  due_at: string | null;
  state: HomeworkState;
  /**
   * True ONLY while `state === "open"`. `no_deadline` is deliberately NOT locked: the owner's
   * condition never arrives for such a homework, so the figures show and the page says they
   * cover whoever has handed in so far.
   */
  locked: boolean;
}

/**
 * A locked response: the homework block, and nothing else.
 *
 * It arrives as a 200, never a 403 — "not yet" is not an error, and an error renders as an
 * error. The API layer narrows the payload to exactly this before it reaches a component, so
 * a server that one day sends rows alongside `locked: true` still cannot leak one.
 */
export interface LockedAnalysis {
  homework: HomeworkBlock;
}

export type AssessmentHomeworkAnalysis = AssessmentItemAnalysis & { homework: HomeworkBlock };

export type AssessmentAssignmentAnalysis = LockedAnalysis | AssessmentHomeworkAnalysis;

/**
 * How many of the homework's papers this response covers, when it does not cover all of them.
 *
 * One assignment can bundle several past papers and each one is a full aggregation, so a
 * request analyses at most a fixed number of them. Truncating without saying so is forbidden
 * here: a teacher reading three papers' worth of numbers would have no way to know a fourth
 * existed.
 */
export interface PapersTruncated {
  /** How many papers this response actually analysed. */
  analysed: number;
  /** How many the homework carries. */
  total: number;
  /**
   * The server's own sentence about the cap, rendered as written when it sends one.
   *
   * It knows the limit it applied and where the rest can be read; paraphrasing a disclosure
   * the backend already worded is how the two drift apart.
   */
  note: string | null;
}

export interface PastpaperPapersAnalysis {
  homework: HomeworkBlock;
  /** One full analysis per attached paper, each keeping the single-paper shape. */
  papers: PastpaperItemAnalysis[];
  /** `null` in the ordinary case — every paper on the homework was analysed. */
  papers_truncated: PapersTruncated | null;
}

export type PastpaperAssignmentAnalysis = LockedAnalysis | PastpaperPapersAnalysis;

/** The one safe way to ask whether a response is locked. Never re-derive it from a date. */
export function isLockedAnalysis(
  payload: AssessmentAssignmentAnalysis | PastpaperAssignmentAnalysis,
): boolean {
  return payload.homework.locked === true;
}

/**
 * The two guards a component reads rows through — positive, and belt-and-braces.
 *
 * Each asks two questions, not one: the server said this homework is not locked, AND the rows
 * it would have withheld are actually here. A locked payload that somehow arrived carrying
 * question rows still fails the first half, and an unlocked one missing them fails the second
 * rather than crashing halfway down a render. They narrow *towards* the richer type on
 * purpose: `payload is LockedAnalysis` would be worse than useless, because the rich types
 * structurally satisfy `LockedAnalysis` and TypeScript would narrow the else-branch to
 * `never` — silently switching off every check on the very code that reads the rows.
 */
export function isAssessmentHomeworkAnalysis(
  payload: AssessmentAssignmentAnalysis,
): payload is AssessmentHomeworkAnalysis {
  return (
    payload.homework.locked === false &&
    Array.isArray((payload as AssessmentHomeworkAnalysis).questions)
  );
}

export function isPastpaperHomeworkAnalysis(
  payload: PastpaperAssignmentAnalysis,
): payload is PastpaperPapersAnalysis {
  return (
    payload.homework.locked === false &&
    Array.isArray((payload as PastpaperPapersAnalysis).papers)
  );
}
