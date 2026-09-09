/**
 * Turning the support-report payload into the words on the page.
 *
 * Pure and separate from the components because the rules that matter here are the ones a
 * type-check cannot enforce:
 *
 * 1. **A null rate is "we do not know", never 0%.** A teacher who settled nothing has no
 *    attendance rate, and printing 0% for them reports a desk everybody skipped.
 * 2. **No raw DB enum reaches the screen.** `NO_SHOW` is "Did not attend", and a `BOOKED`
 *    booking whose hour has already passed is "Not settled yet" — the actionable state, not a
 *    neutral one.
 * 3. **The backlog is stated in what it costs**, not in a count. "32 sessions" is a number;
 *    "32 sessions that paid nobody" is the finding.
 */
import type {
  MonthKey,
  StatusOption,
  SupportCounts,
  SupportSessionRow,
  SupportStatus,
} from "./types";
import { STATUS_UNSETTLED } from "./types";

/** The one em dash on this page, and it means exactly one thing: no number exists. */
export const NO_VALUE = "—";

/** What a name column shows when the payload has no name for somebody. */
export const UNNAMED = "Unnamed";

export function personName(name: string | null | undefined): string {
  return name?.trim() || UNNAMED;
}

/* ── rates ──────────────────────────────────────────────────────────────────────────── */

/**
 * **The backend sends a fraction, not a percentage.** `attendance_rate` is
 * `round(held / (held + no_show), 4)` — 0.7576, not 75.76 — so every renderer has to scale
 * it. Getting this wrong prints "1%" for a desk with perfect attendance, which is the kind of
 * error that looks like a real finding.
 */
export function ratePercent(rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  return Math.round(rate * 1000) / 10;
}

/** A rate as a percentage, or the em dash when there is none. */
export function formatRate(rate: number | null | undefined): string {
  const pct = ratePercent(rate);
  if (pct == null) return NO_VALUE;
  // Whole percents unless the tenth carries information — "76%" reads, "75.8%" is precise.
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

/** The denominator behind an attendance rate: everyone settled either way. */
export function settledCount(counts: Pick<SupportCounts, "held" | "no_show">): number {
  return counts.held + counts.no_show;
}

/**
 * Why an attendance rate is missing, for the `title` on the em dash.
 *
 * Two genuinely different causes, and an admin chasing a blank cell needs to know which one
 * they have: a desk that ran nothing, versus a desk that ran hours and settled none of them.
 * The second is a backlog with a name on it.
 */
export function attendanceReason(
  counts: Pick<SupportCounts, "held" | "no_show" | "unsettled" | "bookings">,
): string {
  if (counts.unsettled > 0) {
    return (
      `Nothing here was settled, so there is no attendance rate to compute. ` +
      `${plural(counts.unsettled, "session")} in this month ` +
      `${counts.unsettled === 1 ? "is" : "are"} still waiting for somebody to mark who came.`
    );
  }
  if (counts.bookings === 0) {
    return "No hours were booked here, so there is nothing to compute a rate over.";
  }
  return "Nobody was marked as attending or missing, so there is nothing to compute a rate over.";
}

/** "9 of 12" — the counts a rate is made of, always shown beside it. */
export function formatShare(numerator: number, denominator: number): string {
  return `${numerator} of ${denominator}`;
}

/* ── status ─────────────────────────────────────────────────────────────────────────── */

/**
 * Fallback English for `SupportBooking.status`.
 *
 * The backend sends `status_label` on every row and `status_labels` on the monthly payload,
 * and those win — they are read from the model's own choices, so the two cannot drift. This
 * map exists for the render that happens before a payload arrives, and for the one status the
 * server cannot label on its own: see {@link UNSETTLED_LABEL}.
 */
export const STATUS_LABEL: Record<SupportStatus, string> = {
  BOOKED: "Booked",
  HELD: "Held",
  NO_SHOW: "Did not attend",
  CANCELLED: "Cancelled",
};

/**
 * A past `BOOKED` booking is not "booked" — it is a session nobody ever settled.
 *
 * The backend cannot express this in `status_label`, because it is a property of the row's
 * *hour* rather than of its status: the same `BOOKED` is next Tuesday's appointment on one row
 * and August's unfinished paperwork on another. `is_unsettled` is what tells them apart.
 */
export const UNSETTLED_LABEL = "Not settled yet";

export type StatusTone = "held" | "missed" | "cancelled" | "unsettled" | "upcoming";

/**
 * The words and the colour for one row's status.
 *
 * Prefers the server's own `status_label` so the vocabulary cannot drift, and overrides it in
 * exactly one case — the one the server cannot see.
 */
export function sessionStatusLabel(
  row: Pick<SupportSessionRow, "status" | "is_unsettled" | "status_label">,
): { label: string; tone: StatusTone } {
  const server = row.status_label?.trim();
  if (row.status === "HELD") return { label: server || STATUS_LABEL.HELD, tone: "held" };
  if (row.status === "NO_SHOW") return { label: server || STATUS_LABEL.NO_SHOW, tone: "missed" };
  if (row.status === "CANCELLED") {
    return { label: server || STATUS_LABEL.CANCELLED, tone: "cancelled" };
  }
  return row.is_unsettled
    ? { label: UNSETTLED_LABEL, tone: "unsettled" }
    : { label: server || STATUS_LABEL.BOOKED, tone: "upcoming" };
}

/** What each outcome means, on hover. Written for somebody who does not run the desk. */
export const STATUS_NOTE: Record<StatusTone, string> = {
  held: "The support teacher confirmed the student came. This is the only outcome that pays points.",
  missed: "The seat was taken and the student did not turn up. It pays nothing.",
  cancelled: "Called off before the hour, so the seat went back to the calendar.",
  unsettled:
    "This hour has already passed and nobody marked who came, so it paid nobody — not the student, not anyone. It stays that way until the support teacher settles it.",
  upcoming: "Still to come. Nothing is owed on it yet.",
};

/**
 * The status filter's options, when the server's list has not arrived yet.
 *
 * Same vocabulary and same order the backend sends: the four real statuses, then the
 * `UNSETTLED` pseudo-status that separates August's unfinished hours from next Tuesday's
 * appointment.
 */
export const FALLBACK_STATUS_OPTIONS: StatusOption[] = [
  { value: "BOOKED", label: STATUS_LABEL.BOOKED },
  { value: "HELD", label: STATUS_LABEL.HELD },
  { value: "NO_SHOW", label: STATUS_LABEL.NO_SHOW },
  { value: "CANCELLED", label: STATUS_LABEL.CANCELLED },
  { value: STATUS_UNSETTLED, label: UNSETTLED_LABEL },
];

/* ── time ───────────────────────────────────────────────────────────────────────────── */

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
 * slide a September session into August for anyone west of Tashkent.
 */
export function monthLabel(month: MonthKey | null | undefined): string {
  if (!month) return "";
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const name = MONTH_NAMES[Number(m[2]) - 1];
  return name ? `${name} ${m[1]}` : month;
}

/**
 * The first day of a month, as the inclusive `from` the history's date input wants.
 *
 * String surgery rather than `Date` arithmetic, for the same timezone reason as above.
 */
export function monthStart(month: MonthKey | null | undefined): string {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return "";
  return `${month}-01`;
}

/** The last day of a month, inclusive — which is what the backend's `to` means. */
export function monthEnd(month: MonthKey | null | undefined): string {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return "";
  const [y, m] = month.split("-").map(Number);
  // Day 0 of the NEXT month is the last day of this one. A bare year/month/day carries no
  // time, so no timezone can move it.
  const last = new Date(y, m, 0).getDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/**
 * An ISO datetime as "9 Sep 2026, 14:00", or the em dash when there is none.
 *
 * Rendered in the reader's own locale and timezone, matching the support teacher's diary and
 * the student's booking page — one hour must not read as two different times depending on
 * which page of this product you are on.
 */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return NO_VALUE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NO_VALUE;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Just the date — "9 Sep 2026". Used where a time would be noise. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return NO_VALUE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NO_VALUE;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "14:00" — the hour, on its own line under the date. "" when there is none. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * How long ago, in whole days. `null` when there is no date or it is in the future.
 *
 * The age is the point of the backlog banner: an hour left unsettled since August is not the
 * same finding as one left since yesterday, and a bare date makes the reader do the
 * subtraction.
 */
export function ageInDays(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  return days >= 0 ? days : null;
}

/** "4 months ago", "23 days ago", "today" — the age of the oldest unsettled hour. */
export function ageLabel(days: number | null): string {
  if (days == null) return "";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

/* ── prose ──────────────────────────────────────────────────────────────────────────── */

/** "1 session" / "3 sessions", and the same for students and hours. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

/** "Aziza", "Aziza and Nodir", "Aziza, Nodir and Kamola" — names in a sentence. */
export function nameList(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The sub-line under a teacher's name: what their month was made of.
 *
 * `slots_published` and `bookings` are different facts and a row that shows one without the
 * other invites the reader to think the other is missing — the school prices support per
 * head, so one hour run as a small group is one slot and three bookings.
 */
export function teacherSubline(counts: SupportCounts): string {
  const parts = [
    plural(counts.slots_published, "hour published", "hours published"),
    plural(counts.bookings, "booking"),
  ];
  if (counts.students_booked > 0) {
    parts.push(plural(counts.students_booked, "student"));
  }
  return parts.join(" · ");
}

/**
 * A blank topic is common — the field is optional at booking — and an empty cell leaves the
 * reader unsure whether nothing was typed or the report lost it.
 */
export const NO_TOPIC = "No topic given";

export function topicText(row: Pick<SupportSessionRow, "topic">): string | null {
  const t = row.topic?.trim();
  return t ? t : null;
}

/** "1–50 of 118" — where the visible page sits in the whole result set. */
export function pageRange(offset: number, shown: number, count: number): string {
  if (count === 0) return "0";
  return `${offset + 1}–${offset + shown} of ${count}`;
}
