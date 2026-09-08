/**
 * Presentation helpers for the question-analysis page. Pure string/number work, no JSX, so
 * the rules that matter most here can be tested directly (`format.test.ts`).
 *
 * Two of them are house rules that were paid for in incidents:
 *
 * **A rate we do not know is an em dash, never 0%.** The backend returns `null` when the
 * denominator is empty, and the difference between "nobody answered this yet" and "everybody
 * got it right" is the difference between a teacher ignoring a question and re-teaching it.
 * `formatPercent` refuses to invent the second from the first.
 *
 * **A raw database enum never reaches the screen.** Most of this payload arrives with a
 * `*_label` field from the server and those are used as-is; `humanEnum` is the safety net for
 * the few values that do not (a paper's `subject`, an unrecognised code from a newer backend),
 * so the worst case is "Module 1 Active" rather than `MODULE_1_ACTIVE`.
 */

/** Stands in for a rate whose denominator is empty. */
export const EM_DASH = "—";

/** Why an em dash is standing where a percentage should be. Goes in a `title`. */
export const UNKNOWN_RATE_TITLE =
  "No answers to divide by yet, so there is no rate — this is not 0%.";

/** The school owner's rule, and the bounds the backend clamps to. */
export const DEFAULT_THRESHOLD = 25;
export const MIN_THRESHOLD = 1;
export const MAX_THRESHOLD = 100;

/** At or above this the backend flags a question as a likely broken answer key. */
export const SUSPECT_KEY_THRESHOLD = 90;

/** A percentage we actually know, or an em dash. Never `0%` for an unknown. */
export function formatPercent(value: number | null | undefined): string {
  return value == null ? EM_DASH : `${value}%`;
}

/** Whole numbers with thousands separators, for the counts beside every rate. */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** `1 student` / `2 students`. English only — there is no i18n system here. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/**
 * Subject-verb agreement for the count-led sentences on this page. Every caveat here starts
 * with a number, and "1 sitting were excluded" reads like a bug in the sentence that is
 * explaining a bug in the data.
 */
export function agree(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** The heading over the flagged list, which has to survive a count of nought and of one. */
export function flaggedHeading(count: number): string {
  if (count === 0) return "Nothing to go over";
  if (count === 1) return "Go over this question";
  return `Go over these ${formatCount(count)} questions`;
}

/**
 * Clamp a threshold the same way the backend does, so the control can never ask for a report
 * the server will quietly hand back at a different cut-off. Junk falls back to the rule.
 */
export function clampThreshold(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return DEFAULT_THRESHOLD;
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, Math.round(parsed)));
}

const SUBJECT_LABELS: Record<string, string> = {
  ENGLISH: "English",
  MATH: "Math",
  READING_WRITING: "Reading & Writing",
  READING: "Reading",
  WRITING: "Writing",
  BOTH: "English & Math",
};

/** `SCREAMING_SNAKE` → `Screaming snake`. The fallback, not the first choice. */
export function humanEnum(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  const words = value.toLowerCase().split(/[_\s-]+/).filter(Boolean);
  if (!words.length) return "";
  return words
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** A subject code as a person would say it. Falls back to `humanEnum`, never to the code. */
export function subjectLabel(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  return SUBJECT_LABELS[value.toUpperCase()] ?? humanEnum(value);
}

/**
 * How a past paper is named in the picker. `title` is optional on the wire and
 * `collection_name` is the old pack name, so both are folded in and neither is assumed.
 */
export function paperLabel(paper: {
  id: number;
  title?: string;
  collection_name?: string;
  subject?: string;
}): string {
  const title = (paper.title ?? "").trim();
  const collection = (paper.collection_name ?? "").trim();
  const subject = subjectLabel(paper.subject);
  const head = title || collection || `Past paper #${paper.id}`;
  const tail = title && collection && collection !== title ? ` · ${collection}` : "";
  return subject ? `${head}${tail} · ${subject}` : `${head}${tail}`;
}

/**
 * Bar width for a breakdown row, as a CSS percentage string. An unknown rate gets no bar at
 * all rather than a zero-width one, so "we do not know" does not read as "perfect".
 */
export function barWidth(rate: number | null | undefined): string | null {
  if (rate == null) return null;
  return `${Math.min(100, Math.max(0, rate))}%`;
}

/**
 * The sentence under a flagged assessment row. Spells the denominator out — a rate over two
 * verdicts is a different fact from a rate over twenty, and the row has to say which it is.
 */
export function assessmentWrongLine(row: {
  students_wrong: number;
  students_graded: number;
  ungraded: number;
}): string {
  if (row.students_graded === 0) {
    return row.ungraded > 0
      ? `Nothing graded yet — ${plural(row.ungraded, "answer")} still waiting on a score`
      : "Nobody has answered this yet";
  }
  const base = `${formatCount(row.students_wrong)} of ${plural(
    row.students_graded,
    "graded answer",
  )} got it wrong`;
  return row.ungraded > 0
    ? `${base} · ${plural(row.ungraded, "more answer")} still waiting on a score`
    : base;
}

/**
 * The sentence under a flagged past-paper row. Keeps blank answers visible beside wrong ones:
 * "12 ran out of time" and "12 got it wrong" are different lessons and different actions.
 */
export function pastpaperWrongLine(row: {
  wrong: number;
  answered: number;
  omitted: number;
  seen: number;
}): string {
  const parts: string[] = [];
  if (row.answered === 0) {
    parts.push(
      row.seen === 0 ? "Nobody reached this question" : `Nobody who saw it wrote an answer`,
    );
  } else {
    parts.push(
      `${formatCount(row.wrong)} of ${plural(row.answered, "student")} who answered got it wrong`,
    );
  }
  if (row.omitted > 0) {
    parts.push(`${plural(row.omitted, "student")} left it blank`);
  }
  if (row.seen > 0) {
    parts.push(`${plural(row.seen, "student")} saw it`);
  }
  return parts.join(" · ");
}
