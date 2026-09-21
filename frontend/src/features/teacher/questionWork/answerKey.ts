/**
 * The answer key, as the checking pane needs it — and only ever on a teacher surface.
 *
 * Two teacher surfaces work a question, and each reads it from a different authoring
 * endpoint with a different shape:
 *
 *   past papers  — GET /api/exams/admin/tests/:id/modules/:m/questions/ → AdminQuestionSerializer,
 *                  whose `correct_answer` is a choice LETTER for MCQ and, for a grid-in, the
 *                  model's `correct_answers` field: a COMMA-SEPARATED list of accepted variants
 *                  ("2/3, 0.666, 0.667" — exams/models.py). pastpapers/api.ts already puts it
 *                  through normalizeAdminModuleQuestion, which passes that string through
 *                  untouched, so it arrives here as one ReviewQuestion `correctText`.
 *   assessments  — GET /api/assessments/admin/sets/:id/ → AssessmentSetAdminSerializer, whose
 *                  `correct_answer` is the choice id for MCQ and the value (or a LIST of accepted
 *                  values) otherwise.
 *
 * Both carry `explanation`; both admin serializers list it. The student runner's serializer does
 * not (AssessmentQuestionRunnerSerializer omits it on purpose, and exams' QuestionSerializer
 * never had it), and nothing here changes that — this module is only ever imported by
 * features/teacher/**.
 *
 * The two shapes get two adapters rather than one because they do not agree on two things, and
 * both of them decide a verdict:
 *   · the multi-answer case — a grid-in accepts several values, spelled as one comma-separated
 *     string on a past paper and as a JSON list on an assessment. Either way the joined text a
 *     teacher READS ("2/3, 0.666, 0.667") is never the value to COMPARE, which is why `accepted`
 *     is a list and `label` is a sentence.
 *   · how the real grader compares — see `AnswerCompare`. The two backends grade the same
 *     question differently enough that a single string comparison here would disagree with one
 *     of them, and a Check that calls a right answer wrong is worse than no Check at all.
 */

import type { AssessmentChoice, AssessmentQuestion } from "@/features/assessments/types";
import type { ReviewQuestion } from "@/features/reviewCenter/types";

/** The em dash normalize.ts writes when a question has no recorded answer at all. */
const NO_ANSWER = "—";

/**
 * Mirrors `exams.models._GRID_IN_TOLERANCE`: a past-paper grid-in is graded numerically within
 * this much, so 0.666 and 0.667 both pass against 2/3 and .5 passes against 0.5.
 */
const GRID_IN_TOLERANCE = 1e-4;

/**
 * How the question's own grader decides, mirrored from the backend that owns it. Judging with
 * anything else means the pane can contradict the score the student's attempt is given.
 *
 *   text     — case-insensitive match. Exams MCQ (`Question.check_answer`'s non-math branch)
 *              and assessments `multiple_choice` / `short_text` (`grading._norm_text`).
 *   gridIn   — a past-paper grid-in: `Question.check_answer` splits the key on "," and compares
 *              each variant numerically (decimal or simple a/b) within the tolerance above,
 *              falling back to a string match for any variant that is not a number.
 *   numeric  — an assessment `numeric`: `grading.grade_answer` parses both sides as decimals and
 *              compares within `grading_config.tolerance`, or exactly when no tolerance is set.
 *              A non-numeric answer is simply not correct there — no string fallback.
 *   boolean  — an assessment `boolean`: true/t/1/yes/y against false/f/0/no/n.
 */
export type AnswerCompare =
  | { mode: "text" }
  | { mode: "gridIn" }
  | { mode: "numeric"; tolerance: number | null }
  | { mode: "boolean" };

export type AnswerKey = {
  /** Every value that counts as right, compared the way `compare` says. Empty = none recorded. */
  accepted: string[];
  /** What the teacher reads: "B. To dispute an old estimate", or "2/3, 0.666, 0.667". Empty when none. */
  label: string;
  /** The worked solution as authored. Empty when nobody has written one yet. */
  explanation: string;
  /** Which grader this question's answer belongs to. */
  compare: AnswerCompare;
};

export const EMPTY_ANSWER_KEY: AnswerKey = {
  accepted: [],
  label: "",
  explanation: "",
  compare: { mode: "text" },
};

function clean(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/**
 * A past-paper question (and anything else already normalized to the read-only review shape).
 * For MCQ the letters in `correctIds` ARE the comparable values; for a grid-in `correctText` is
 * the model's raw comma-separated variant list, so it is split here exactly as
 * `Question.check_answer` splits it. `label` keeps the whole list, because a teacher wants to
 * read every value that would have been accepted, not just the one that matched.
 */
export function answerKeyFromReviewQuestion(q: Pick<ReviewQuestion, "isChoice" | "correctIds" | "correctText" | "explanation">): AnswerKey {
  const text = clean(q.correctText);
  const shown = text === NO_ANSWER ? "" : text;
  const accepted = q.isChoice
    ? q.correctIds.map(clean).filter((v) => v !== "")
    : shown
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v !== "");
  return {
    accepted,
    label: shown,
    explanation: clean(q.explanation),
    compare: q.isChoice ? { mode: "text" } : { mode: "gridIn" },
  };
}

/**
 * An assessment-set question, straight off the admin set endpoint. `correct_answer` is a choice
 * id for MCQ; for every other type it may be one value or a list of accepted ones, and each
 * element of that list is independently correct.
 */
export function answerKeyFromAssessmentQuestion(q: AssessmentQuestion): AnswerKey {
  const raw = q.correct_answer;
  const accepted = (Array.isArray(raw) ? raw : [raw]).map(clean).filter((v) => v !== "");

  const isChoice = q.question_type === "multiple_choice";
  const choices: AssessmentChoice[] = Array.isArray(q.choices) ? (q.choices as AssessmentChoice[]) : [];
  const label = isChoice
    ? accepted
        .map((id) => {
          const ch = choices.find((c) => String(c?.id) === id);
          return ch ? `${ch.id}. ${ch.text}` : id;
        })
        .join(", ")
    : accepted.join(", ");

  return { accepted, label, explanation: clean(q.explanation), compare: assessmentCompare(q) };
}

function assessmentCompare(q: AssessmentQuestion): AnswerCompare {
  if (q.question_type === "numeric") {
    // The set author's own tolerance, read from the same place grading_service passes it from.
    // Absent means an exact decimal comparison, which is what grade_answer does with no config.
    return { mode: "numeric", tolerance: toNumber(clean((q.grading_config ?? {})["tolerance"])) };
  }
  if (q.question_type === "boolean") return { mode: "boolean" };
  return { mode: "text" };
}

/**
 * A number as either backend parses one: a decimal, or a simple ``a/b`` fraction (a grid-in
 * answer is often written 2/3). Null for anything that is not one, and for a zero denominator.
 */
function toNumber(value: string): number | null {
  const s = value.trim();
  if (s === "") return null;
  if (s.includes("/")) {
    const [num, den] = [s.slice(0, s.indexOf("/")), s.slice(s.indexOf("/") + 1)];
    const n = plainNumber(num);
    const d = plainNumber(den);
    if (n == null || d == null || d === 0) return null;
    return n / d;
  }
  return plainNumber(s);
}

function plainNumber(s: string): number | null {
  const t = s.trim();
  // Number("") is 0 and Number(" 1 2 ") is NaN — the empty guard is what makes this safe.
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Folded the way `assessments.grading._norm_text` folds: NFKC (a full-width "４" typed on a
 * phone keyboard is a 4), lower case, and inner runs of whitespace collapsed.
 */
function normText(s: string): string {
  let out = s;
  try {
    out = out.normalize("NFKC");
  } catch {
    // An engine without full NFKC data still gets the case and whitespace folding.
  }
  return out.trim().toLowerCase().split(/\s+/).join(" ");
}

const TRUE_WORDS = new Set(["true", "t", "1", "yes", "y"]);
const FALSE_WORDS = new Set(["false", "f", "0", "no", "n"]);

function toBool(s: string): boolean | null {
  const t = normText(s);
  if (TRUE_WORDS.has(t)) return true;
  if (FALSE_WORDS.has(t)) return false;
  return null;
}

/** One accepted variant against what the teacher typed, under this question's grader. */
function matchesVariant(given: string, variant: string, compare: AnswerCompare): boolean {
  if (compare.mode === "boolean") {
    const a = toBool(given);
    return a != null && a === toBool(variant);
  }

  if (compare.mode === "numeric") {
    const a = toNumber(given);
    const b = toNumber(variant);
    if (a == null || b == null) return false;
    // No tolerance configured = exact, as grade_answer's `a == c` branch is. Both sides come
    // from the same parse, so the values a teacher actually types (0.5, 1/2, 5.0) land on the
    // same double; a tolerance is the author's tool for anything rounder than that.
    return compare.tolerance == null ? a === b : Math.abs(a - b) <= compare.tolerance;
  }

  if (compare.mode === "gridIn") {
    const a = toNumber(given);
    const b = toNumber(variant);
    if (a != null && b != null) return Math.abs(a - b) <= GRID_IN_TOLERANCE;
    // check_answer falls back to a string match per variant, so a grid-in whose key is a word
    // ("undefined", "no solution") still grades the way the student's paper graded it.
  }

  return normText(given) === normText(variant);
}

/**
 * "unknown" is not a hedge — it is the honest verdict when the question carries no recorded
 * answer. Calling an unjudgeable answer wrong would tell a teacher their own working is at
 * fault when it is the question that is incomplete.
 */
export type Verdict = "correct" | "incorrect" | "unknown";

export function judgeAnswer(answer: string | null, key: AnswerKey): Verdict {
  if (answer == null || answer === "") return "unknown";
  if (key.accepted.length === 0) return "unknown";
  return key.accepted.some((v) => matchesVariant(answer, v, key.compare)) ? "correct" : "incorrect";
}
