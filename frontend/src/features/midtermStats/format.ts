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

/**
 * Why a row's headcount and its rate's denominator are different numbers.
 *
 * Every ranked row prints both — "12 classes · 180 students" beside "150 of 210" — and they
 * disagree for two ordinary reasons: a class that sat two papers this month is on the roster
 * twice, and 112 of the school's 226 students hold two active memberships, so a student in
 * two of the pooled classes is counted in both. Neither is a bug, and neither is obvious.
 * A row that shows two denominators and reconciles neither is read as one of them being
 * wrong.
 *
 * `null` when they agree, so nothing is explained that needs no explaining.
 */
export function rosterNote(roster: number, distinctStudents: number): string | null {
  if (roster === distinctStudents) return null;
  return (
    `Two different counts, both correct: ${plural(distinctStudents, "student")} sat under ` +
    `this row, filling ${plural(roster, "roster place")}. A student in two of these classes ` +
    `is on two rosters, and a class that sat two papers is counted once per paper — every ` +
    `rate here is over roster places, which is what pooling asks for.`
  );
}

/**
 * The sub-line under a ranked row's name: what the row is pooled over.
 *
 * Names the roster count too whenever it differs from the headcount, so the rate's
 * denominator is never a number that appears nowhere else on the row.
 */
export function groupSubline(row: {
  classrooms: number;
  distinct_students: number;
  roster: number;
}): string {
  const parts = [
    plural(row.classrooms, "class", "classes"),
    plural(row.distinct_students, "student"),
  ];
  if (row.roster !== row.distinct_students) parts.push(plural(row.roster, "roster place"));
  return parts.join(" · ");
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

/* ── a month the school has not reached ─────────────────────────────────────────────── */

/**
 * What a figure reads as in a month nobody has sat yet.
 *
 * Deliberately NOT {@link NO_VALUE}: the em dash means "there was nothing to divide by", and
 * a scheduled month is not that — the roster is known, the papers are booked, and the answer
 * simply does not exist yet. Two different absences of a number, two different words.
 */
export const SCHEDULED = "Scheduled";

/** Whether `month` is one of the months nobody has sat yet, per the payload's own list. */
export function isScheduledMonth(
  month: MonthKey | null | undefined,
  futureMonths: readonly MonthKey[] | undefined,
): boolean {
  return Boolean(month) && (futureMonths ?? []).includes(month as MonthKey);
}

/**
 * The picker's option text. A scheduled month says so IN THE OPTION.
 *
 * The backend refuses to open on a future month, but the picker still offers it — and it sorts
 * first, directly under the reader's cursor. Choosing it has to be an informed choice rather
 * than the discovery that the school scored zero.
 */
export function monthOptionLabel(
  month: MonthKey,
  futureMonths: readonly MonthKey[] | undefined,
): string {
  return isScheduledMonth(month, futureMonths)
    ? `${monthLabel(month)} (scheduled)`
    : monthLabel(month);
}

/**
 * The newest month in `months` that has actually been sat — what a reader stranded on a
 * scheduled month should be offered instead. `null` when every month is still ahead.
 *
 * The same choice `stats.default_month` makes on the server, made again here only to label a
 * button; the month the page opens on is always the backend's answer, never this one.
 */
export function latestSatMonth(
  months: readonly MonthKey[] | undefined,
  futureMonths: readonly MonthKey[] | undefined,
): MonthKey | null {
  return (months ?? []).find((m) => !isScheduledMonth(m, futureMonths)) ?? null;
}

/** "Midterm 12 Retake", "A and B", "A, B and C" — a list of names in a sentence. */
export function titleList(titles: readonly string[]): string {
  if (titles.length === 0) return "";
  if (titles.length === 1) return titles[0];
  return `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}`;
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
  default_month: "Which month this page opens on",
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

/* ── what the one chart is allowed to plot ──────────────────────────────────────────── */

/**
 * The fewest groups worth drawing a chart of.
 *
 * Two bars are a sentence, not a chart: the ranked table beside them already says which is
 * higher and by how much, in numbers, with the counts attached. Three is where the shape of
 * a distribution starts carrying information a column of percentages does not.
 */
export const MIN_CHART_GROUPS = 3;

export type ChartBar = { name: string; rate: number };

/**
 * The bars, and only the bars that mean what a bar means.
 *
 * Two exclusions, and the second is the one that mattered. A row with no rate cannot be
 * plotted at all. And the **"Unassigned" bucket is a hole in the record, not a group** —
 * classrooms created since the branch field was dropped from the create form carry
 * `branch = NULL` and were never backfilled, so plotting them alongside Chilonzor and
 * Yunusobod puts "Unassigned 62%" in a chart titled *Pass rate by branch* and invites a
 * director to read a failing branch where there is a data-entry gap spanning every branch.
 * The ranked table keeps the row and marks it as the gap it is; the chart must not average
 * it in among real ones.
 */
export function chartBars<T extends { id: number | null; name: string; pass_rate: number | null }>(
  rows: T[],
  max: number,
): { bars: ChartBar[]; unrated: number; gaps: number; truncated: number } {
  const gaps = rows.filter(isUnassigned).length;
  const plottable = rows.filter((r) => !isUnassigned(r) && r.pass_rate != null);
  const unrated = rows.length - gaps - plottable.length;
  const bars = plottable
    .slice(0, max)
    .map((r) => ({ name: r.name, rate: r.pass_rate as number }));
  return { bars, unrated, gaps, truncated: plottable.length - bars.length };
}
