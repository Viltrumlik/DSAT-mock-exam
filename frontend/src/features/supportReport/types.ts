/**
 * Wire types for the ops support-session report.
 *
 * Backend: `classes/support_report.py` (the aggregation) and `classes/views_support_report.py`
 * (the two endpoints). Every field here is one the backend actually emits — the keys are
 * asserted in `classes/tests_support_report.py`, so this file is a transcription, not a guess.
 *
 * Kept separate from `features/opsSupport/opsSupportApi.ts` on purpose: that module is about
 * *configuring* the desk (who teaches support, which hours they keep) and shares no shape with
 * these read-only roll-ups of what actually happened.
 *
 * The payload is **flat** — `support_teacher_id` + `support_teacher`, not a nested object —
 * because `support_report.session_row` flattens a booking so that no row is ambiguous on its
 * own. The types follow it rather than re-shaping it in a mapper: a mapper here would be one
 * more whitelist to forget a field in.
 */

/** `"YYYY-MM"`, resolved in the school's own timezone (Tashkent), never the browser's. */
export type MonthKey = string;

/** An ISO-8601 datetime string as DRF renders it. */
export type IsoDateTime = string;

/** `SupportBooking.status` on the wire. **Never rendered raw** — see `./format`. */
export type SupportStatus = "BOOKED" | "HELD" | "NO_SHOW" | "CANCELLED";

/**
 * The pseudo-status the history accepts alongside the four real ones.
 *
 * `BOOKED` covers two completely different situations — next Tuesday's appointment, and an
 * August hour nobody ever settled — and the backlog is the headline of this report, so the
 * backend exposes a filter that separates them. Filtering on `BOOKED` alone would mix next
 * week's bookings into August's unfinished ones.
 */
export const STATUS_UNSETTLED = "UNSETTLED";

/** What `?status=` accepts. */
export type HistoryStatus = SupportStatus | typeof STATUS_UNSETTLED;

/** One `{value, label}` from the backend's own status vocabulary, sent with every page. */
export type StatusOption = { value: HistoryStatus; label: string };

/* ── 1. The month ───────────────────────────────────────────────────────────────────── */

/**
 * The counts a month is made of. `SupportReportCounts` on the wire, shared by every teacher
 * row and by the school-wide `total`.
 *
 * **The five outcome counts partition `bookings` exactly** — `held + no_show + cancelled +
 * upcoming + unsettled == bookings` — which is what lets a reader check a row adds up, and
 * what makes the pooled total legitimate.
 */
export type SupportCounts = {
  /** Hours this teacher put on the calendar in the month, withdrawn ones excluded. */
  slots_published: number;
  /** Every booking against a slot in the month, whatever became of it. */
  bookings: number;
  /** Settled HELD: the student came. **The only outcome the reward hook pays for.** */
  held: number;
  /** Settled NO_SHOW: the seat was taken and nobody turned up. */
  no_show: number;
  /** Called off before the hour, so the seat went back to the calendar. */
  cancelled: number;
  /** Still BOOKED and the hour has not happened yet. Nothing is owed on these. */
  upcoming: number;
  /**
   * Still BOOKED although the hour has passed — **this month's share of the backlog**.
   * Nobody settled it, so it paid nobody and it is in neither `held` nor `no_show`.
   */
  unsettled: number;
  /** The oldest of this month's unsettled hours. */
  unsettled_oldest: IsoDateTime | null;
  /** Distinct students with a HELD booking. Lower than `held` when one came twice. */
  students_helped: number;
  /** Distinct students who booked at all, however it ended. */
  students_booked: number;
};

/**
 * One support teacher's month.
 *
 * `backlog_unsettled` / `backlog_oldest` are **all time** and do not move when the month does,
 * unlike `unsettled` above them: a September page still has to be able to say this teacher has
 * hours unsettled since August.
 */
export type MonthlyTeacherRow = SupportCounts & {
  support_teacher_id: number;
  support_teacher: string;
  /**
   * `held / (held + no_show)`, **as a fraction between 0 and 1**, rounded to 4 decimal
   * places — not a percentage. `null` when nobody was settled either way, and **`null` must
   * never render as 0%**: a teacher who has run nothing is not a teacher everybody skipped.
   */
  attendance_rate: number | null;
  backlog_unsettled: number;
  backlog_oldest: IsoDateTime | null;
};

/** The school-wide row. Distinct heads are counted once school-wide, never summed. */
export type SupportTotals = SupportCounts & { attendance_rate: number | null };

/** One teacher's share of the all-time backlog. */
export type BacklogTeacherRow = {
  support_teacher_id: number;
  support_teacher: string;
  unsettled: number;
  oldest: IsoDateTime | null;
};

/**
 * Every past hour nobody ever settled — **all time, never the selected month**.
 *
 * Deliberately unbounded by the picker: a backlog you can page away from is a backlog nobody
 * clears. Narrowed only by `?teacher=`, so a filtered page's banner cannot misattribute the
 * school's backlog to one person.
 */
export type UnsettledBacklog = {
  unsettled: number;
  oldest: IsoDateTime | null;
  /** Sorted by size, largest first. Teachers with none are absent. */
  teachers: BacklogTeacherRow[];
};

/** `GET /api/classes/support/report/monthly/`. */
export type SupportMonthlyReport = {
  /**
   * The month the figures are for. **Never null**: the backend defaults to the school's
   * current month, and `months` always contains it, so the picker is never empty and this
   * page never has to render "no month to show".
   */
  month: MonthKey;
  /** The picker's options, newest first. Months with a published hour, plus this one, and
   *  never a future month — a desk with October slots still opens on September. */
  months: MonthKey[];
  generated_at: IsoDateTime;
  /** Echo of `?teacher=`. null when the report covers the whole desk. */
  teacher_id: number | null;
  teachers: MonthlyTeacherRow[];
  total: SupportTotals;
  backlog: UnsettledBacklog;
  /** The backend's own enum→English map, so the page cannot drift from it. */
  status_labels: Partial<Record<SupportStatus, string>>;
};

/* ── 2. The history ─────────────────────────────────────────────────────────────────── */

/** One booking, flattened for a report table. */
export type SupportSessionRow = {
  id: number;
  /** The hour the session was FOR. The history is ordered by this, not by `booked_at`. */
  starts_at: IsoDateTime;
  ends_at: IsoDateTime;
  slot_id: number;
  /** The support teacher's own note on the hour, if they left one. */
  slot_note: string;
  capacity: number;
  support_teacher_id: number | null;
  support_teacher: string;
  student_id: number;
  student: string;
  classroom_id: number | null;
  classroom_name: string | null;
  /** What the student needed help with. Blank when nobody typed one. */
  topic: string;
  status: SupportStatus;
  /** The backend's English for `status`. Read this, never `status` itself. */
  status_label: string;
  booked_at: IsoDateTime;
  settled_at: IsoDateTime | null;
  settled_by_id: number | null;
  settled_by: string | null;
  /** Who brought the student in. Null for the ordinary case of a student booking themselves. */
  invited_by_id: number | null;
  invited_by: string | null;
  cancel_reason: string;
  cancelled_at: IsoDateTime | null;
  teacher_note: string;
  rating: number | null;
  rating_comment: string;
  /**
   * The row's own copy of the headline: `BOOKED` and the hour has already ended.
   *
   * It is what turns "Booked" into "Not settled yet" on this row. A reader scanning the
   * history has to be able to see the backlog in the table, not only in the banner.
   */
  is_unsettled: boolean;
};

/** `GET /api/classes/support/report/sessions/`. */
export type SupportSessionsReport = {
  results: SupportSessionRow[];
  /** Total matching the filters, behind the page. */
  count: number;
  limit: number;
  offset: number;
  has_more: boolean;
  /** The filter bar's status options, in the server's own vocabulary. */
  statuses: StatusOption[];
};
