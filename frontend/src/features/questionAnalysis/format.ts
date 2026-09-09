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

/**
 * The *other* reason a past-paper rate is empty, and the two must never be confused.
 *
 * "Nobody has answered" and "everything here was held out as a likely broken answer key" both
 * arrive as `null`, but they ask a teacher to do opposite things: wait, versus go and read the
 * answer key. Handing the second one the first one's tooltip would tell a teacher their class
 * never sat a paper they in fact all sat.
 */
export const HELD_OUT_RATE_TITLE =
  "No rate: every question here was held out as a likely broken answer key. This is not 0%, and it is not missing data.";

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
 * Why a breakdown row's rate covers fewer questions than the row counts — or covers none.
 *
 * The backend holds a question at 90%+ out of every group rate, because a row like
 * "Math — 50%" is read as a statement about Math, and one broken answer key is enough to make
 * that statement false. (Measured: a paper whose real Math error rate was 0% reported 50%.)
 * The hold-out is right, but silent: the row prints a rate over fewer questions than its own
 * count implies, and a group that is *entirely* suspect prints an em dash that looks exactly
 * like missing data. This sentence is the difference between a page that changed meaning and
 * a page that says so.
 *
 * `null` when nothing was held out, which is the ordinary case — no note, no noise.
 */
export function heldOutNote(heldOut: number, analysedQuestions: number): string | null {
  if (heldOut <= 0) return null;
  if (analysedQuestions <= 0) {
    return (
      `${
        heldOut === 1
          ? "The one question here is"
          : `All ${formatCount(heldOut)} questions here are`
      } at ${SUSPECT_KEY_THRESHOLD}% or above, which is far more often a wrong answer key ` +
      `than a hard topic. ${agree(heldOut, "It is", "They are")} held out rather than averaged ` +
      "in, so this row has no rate to show — that dash is not a zero, and nothing is missing."
    );
  }
  return (
    `${plural(heldOut, "question")} here ${agree(heldOut, "is", "are")} at ` +
    `${SUSPECT_KEY_THRESHOLD}% or above and held out as a likely broken answer key, so the ` +
    `rate above is over the other ${plural(analysedQuestions, "question")}. ` +
    `${agree(heldOut, "It is", "They are")} still on the list to go over — read the key first.`
  );
}

/**
 * The sentence beside the paper's headline rate, naming the population that rate divided.
 *
 * `totals.error_rate` is read the same way a breakdown row is, so it too holds the suspect
 * keys out — while `totals.wrong` / `totals.answered` stay whole, because they describe the
 * sitting as it was recorded. Printing the rate beside the raw tallies without saying so
 * shows a percentage and a set of counts that do not reconcile, and invites a teacher to
 * check the arithmetic of a page that is in fact correct.
 */
export function analysedTotalsLine(totals: {
  questions: number;
  answered: number;
  wrong: number;
  analysed: { questions: number; seen: number; answered: number; wrong: number };
}): string {
  const { analysed } = totals;
  const heldOut = Math.max(0, totals.questions - analysed.questions);
  const blank = Math.max(0, analysed.seen - analysed.answered);

  if (heldOut === 0) {
    return (
      `${formatCount(totals.wrong)} wrong of ${plural(totals.answered, "answer")}, across ` +
      `every one of the ${plural(totals.questions, "question")} on this paper.`
    );
  }
  if (analysed.questions === 0) {
    return (
      `there is no trustworthy rate for this paper — every one of its ` +
      `${plural(totals.questions, "question")} is at ${SUSPECT_KEY_THRESHOLD}% or above, so ` +
      `all of them are held out as likely broken answer keys. As recorded, the class got ` +
      `${formatCount(totals.wrong)} of ${plural(totals.answered, "answer")} wrong; read the ` +
      "answer key before you read that."
    );
  }
  return (
    `${formatCount(analysed.wrong)} wrong of ${plural(analysed.answered, "answer")}` +
    `${blank > 0 ? `, with ${formatCount(blank)} more left blank` : ""}, over the ` +
    `${formatCount(analysed.questions)} of ${plural(totals.questions, "question")} whose ` +
    `answer key looks sound. ${plural(heldOut, "question")} at ${SUSPECT_KEY_THRESHOLD}% or ` +
    `above ${agree(heldOut, "is", "are")} held out of it. The paper as recorded: ` +
    `${formatCount(totals.wrong)} wrong of ${plural(totals.answered, "answer")}.`
  );
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

/**
 * A deadline a teacher can read without doing date arithmetic.
 *
 * Long-form and absolute — weekday, date, time — because this sentence is the whole content
 * of the locked state, and "05/09/26 18:00" is a thing you decode rather than read. `null`
 * when there is no usable date, so the caller says "once the deadline passes" instead of
 * printing "Invalid Date".
 */
export function formatDeadline(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * "in about 3 days" — a soft hint beside the absolute deadline, never instead of it.
 *
 * Returns `null` when the reader's own clock already puts the deadline in the past. The
 * server decided this homework is still open, against its own `timezone.now()`; a device an
 * hour or a year out would otherwise render "past due" directly under a panel that says the
 * statistics are not out yet. The absolute date above it is always right, so saying nothing
 * is the honest fallback.
 */
export function timeUntilDeadline(
  iso: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const ms = at.getTime() - now;
  if (ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return minutes <= 1 ? "in under a minute" : `in about ${minutes} minutes`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
  const days = Math.round(ms / 86_400_000);
  return days === 1 ? "in about a day" : `in about ${days} days`;
}
