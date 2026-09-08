/**
 * Turning the statistics payload into the words on the page.
 *
 * Pure and separate from the components because the rules that matter here are the ones a
 * type-check cannot enforce:
 *
 * 1. **A null rate is "we do not know", never 0%.** An empty roster, a month nobody sat and a
 *    cohort in which nobody passed all arrive as `null`, and printing 0% for any of them
 *    reports a class as having failed when it was never measured.
 * 2. **No raw DB enum reaches the screen.** READING_WRITING is "Reading & Writing", ENGLISH
 *    is "English", `schedule` is "From the timetable".
 * 3. **The page states its own rule.** These figures are used to judge teachers, so the
 *    sentence describing what was measured is built from the payload's own `definition`
 *    block rather than written here and left to drift out of step with the backend.
 */
import type {
  ClassroomMidtermRow,
  DefinitionKey,
  MidtermType,
  MonthBasis,
  MonthKey,
  StatsDefinition,
  Tally,
} from "./types";
import { DEFINITION_KEYS } from "./types";

/** The one em dash on this page, and it means exactly one thing: no number exists. */
export const NO_VALUE = "—";

/**
 * A rate as a percentage, or the em dash when there is none.
 *
 * `null` is never 0: see the module docstring. Callers pair this with {@link rateReason} so
 * the dash is explained on hover rather than left as a shrug.
 */
export function formatRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return NO_VALUE;
  return `${rate}%`;
}

/**
 * Why a rate is missing, for the `title` on the em dash.
 *
 * The two causes are genuinely different — nobody on the roster, versus nobody among the
 * passers — and an admin chasing a blank cell needs to know which one they have.
 */
export function rateReason(kind: "pass" | "share" | "attendance", roster: number): string {
  if (kind === "share") {
    return "Nobody passed this month, so there is no first-sitting/retake split to show.";
  }
  if (roster === 0) {
    return "No students on the roster this month, so there is nothing to compute a rate over.";
  }
  return "No rate could be computed for this row.";
}

/** "9 of 10" — the counts a rate is made of, always shown beside it. */
export function formatShare(numerator: number, denominator: number): string {
  return `${numerator} of ${denominator}`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * `"2026-09"` → `"September 2026"`. An unparseable key is returned untouched.
 *
 * Deliberately not `toLocaleString`: the month key is a plain string the backend computed in
 * the school's timezone, and handing it to `Date` would re-interpret it in the browser's and
 * slide a September sitting into August for anyone west of Tashkent.
 */
export function monthLabel(month: MonthKey | null | undefined): string {
  if (!month) return "";
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const name = MONTH_NAMES[Number(m[2]) - 1];
  return name ? `${name} ${m[1]}` : month;
}

/**
 * How a `(classroom, paper)` pair got its month.
 *
 * Only `schedule` is a stated fact; the rest are inferences, and the page says so rather
 * than presenting a paper dated by its creation timestamp as though somebody had timetabled
 * it.
 */
export const MONTH_BASIS_LABEL: Record<MonthBasis, string> = {
  schedule: "From the timetable",
  first_sitting: "From the first sitting",
  published: "From the publication date",
  created: "From the creation date",
};

export const MONTH_BASIS_NOTE: Record<MonthBasis, string> = {
  schedule: "This class has a scheduled sitting for this paper, and its date sets the month.",
  first_sitting:
    "This paper was never timetabled for this class, so the month is the earliest completed sitting on its roster.",
  published:
    "This paper was never timetabled for this class and nobody has completed it, so the month is the date the paper was published.",
  created:
    "This paper was never timetabled for this class, nobody has completed it and it was never published, so the month is the date the paper was created.",
};

/** True when the month was inferred rather than timetabled — worth flagging on the row. */
export function isInferredMonth(basis: MonthBasis | null | undefined): boolean {
  return basis != null && basis !== "schedule";
}

const MIDTERM_TYPE_LABELS: Record<MidtermType, string> = {
  PRE_MIDTERM: "Pre-midterm",
  MIDTERM: "Midterm",
  RETAKE: "Retake",
};

export function midtermTypeLabel(type: string): string {
  return MIDTERM_TYPE_LABELS[type as MidtermType] ?? type;
}

/**
 * `Midterm.subject` → English. This vocabulary (READING_WRITING / MATH) is the paper's, and
 * is NOT the classroom's (ENGLISH / MATH) — the two disagree on exactly one value, which is
 * why each has its own map instead of one shared guess.
 */
const MIDTERM_SUBJECT_LABELS: Record<string, string> = {
  READING_WRITING: "Reading & Writing",
  MATH: "Math",
};

export function midtermSubjectLabel(subject: string | null | undefined): string {
  if (!subject) return "";
  return MIDTERM_SUBJECT_LABELS[subject] ?? subject;
}

/** "500 / 800" — a pass mark is meaningless without the ceiling it is out of. */
export function formatPassMark(passMark: number | null, ceiling: number | null): string {
  if (passMark == null) return "Not graded";
  return ceiling ? `${passMark} / ${ceiling}` : String(passMark);
}

/**
 * True when the papers in one month are scored on different ceilings.
 *
 * 72 out of 100 and 640 out of 800 are not the same achievement, and a table that lists them
 * in one column invites exactly that comparison. Pass RATES are always comparable; scores are
 * not, and the page warns when both appear.
 */
export function hasMixedScales(rows: Pick<ClassroomMidtermRow, "score_ceiling">[]): boolean {
  const ceilings = new Set(rows.map((r) => r.score_ceiling).filter((c) => c != null));
  return ceilings.size > 1;
}

/** Headline label for each definition key — the left column of "what these numbers mean". */
const DEFINITION_LABELS: Record<DefinitionKey, string> = {
  pass_rate: "Pass rate",
  absent_counts_as: "An absent student",
  rollup: "Branch, department and teacher rates",
  denominator: "The denominator",
  first_try_share: "First-sitting share",
  excluded: "Not counted",
  month: "Which month a paper falls in",
  empty_denominator: "Nothing to divide by",
};

export type DefinitionEntry = { key: DefinitionKey; label: string; text: string };

/** The definition block as ordered rows, skipping anything the backend did not send. */
export function definitionEntries(definition: StatsDefinition | undefined): DefinitionEntry[] {
  if (!definition) return [];
  return DEFINITION_KEYS.filter((key) => Boolean(definition[key])).map((key) => ({
    key,
    label: DEFINITION_LABELS[key],
    text: definition[key] as string,
  }));
}

/**
 * The one quiet line the page always shows, built from the payload's own definition.
 *
 * Five readers of an unlabelled percentage will assume five different rules; this is the
 * sentence that stops that happening. It degrades to a plain English statement of the same
 * rule if the backend ever stops sending a key.
 */
export function definitionLine(definition: StatsDefinition | undefined): string {
  const rate = definition?.pass_rate ?? "passed (first sitting or retake) / all roster students";
  const absent = definition?.absent_counts_as ?? "failed";
  const rollup = definition?.rollup ?? "pooled";
  return (
    `Pass rate is ${rate}. An absent student counts as ${absent}. ` +
    `Branch, department and teacher rates are ${rollup} — their classrooms' passers over ` +
    `their classrooms' rosters, never an average of percentages.`
  );
}

/**
 * "84% passed first time · 16% needed the retake", or null when nobody passed.
 *
 * A share of the PASSERS, never of the roster — the owner's "keyingi bosqichga o'tgan
 * o'quvchilardan" is explicitly about the students who got through.
 */
export function passerSplit(tally: Pick<Tally, "first_try_share" | "retake_share" | "passed">):
  | { first: string; retake: string }
  | null {
  if (tally.passed <= 0 || tally.first_try_share == null) return null;
  return {
    first: formatRate(tally.first_try_share),
    retake: formatRate(tally.retake_share),
  };
}

/** A row's name for a branch or teacher bucket that has none. */
export const UNASSIGNED = "Unassigned";

export function isUnassigned(row: { id: number | null; name: string }): boolean {
  return row.id == null || row.name === UNASSIGNED;
}

/** What "Unassigned" actually means, per table. A real data gap, never a zero. */
export const UNASSIGNED_BRANCH_NOTE =
  "Classrooms with no branch set. A create-form regression left these unset and they were never backfilled — they are a known gap in the record, not a branch that scored nothing.";

export const UNASSIGNED_TEACHER_NOTE =
  "Classrooms with no teacher assigned. Their students still count in the school total.";

/** "1 paper" / "3 papers", and the same for students and classes. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
