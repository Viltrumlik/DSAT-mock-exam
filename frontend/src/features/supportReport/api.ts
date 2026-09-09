/**
 * Client for the read-only support-session report (`/api/classes/support/report/`).
 *
 * Two calls, two surfaces: one month of the whole desk, and the session-by-session history
 * under it. Every URL in this feature lives here — `scripts/check-api-layer.sh` fails the
 * build if a request string appears anywhere else, and `lib/api.ts` is what owns the base URL,
 * the auth header and the refresh retry.
 *
 * It rides `/api/classes/`, never a new namespace: the admin console is host-guarded and only
 * a handful of prefixes are allowlisted, so a route anywhere else 403s before DRF is reached.
 */
import api from "@/lib/api";
import type {
  HistoryStatus,
  MonthKey,
  SupportMonthlyReport,
  SupportSessionsReport,
} from "./types";

const BASE = "/classes/support/report";

/**
 * The history's filters. Every one is optional; an omitted key is "no filter".
 *
 * `student` is an **id**, not a name — the backend filters on `student_id`. The picker that
 * chooses it is built from the students already on screen; see `SessionHistory`.
 */
export type SessionFilters = {
  teacher?: number | null;
  student?: number | null;
  /** Local `YYYY-MM-DD`, **inclusive**. */
  from?: string | null;
  /** Local `YYYY-MM-DD`, **inclusive** — the whole of that day. */
  to?: string | null;
  status?: HistoryStatus | null;
  offset?: number;
  limit?: number;
};

/**
 * Only the filters that are actually set.
 *
 * An empty string is not a filter — sending `status=` asks the backend to match a status
 * called "", which it answers with a 400. Both come straight off a cleared control, so they
 * are dropped here rather than at five call sites.
 */
function params(filters: SessionFilters): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (filters.teacher != null) out.teacher = filters.teacher;
  if (filters.student != null) out.student = filters.student;
  if (filters.from) out.from = filters.from;
  if (filters.to) out.to = filters.to;
  if (filters.status) out.status = filters.status;
  if (filters.offset) out.offset = filters.offset;
  if (filters.limit) out.limit = filters.limit;
  return out;
}

export const supportReportApi = {
  /**
   * One month of the desk: a row per support teacher, the pooled school total, and the
   * all-time unsettled backlog carried alongside so the banner needs no second request.
   *
   * `month` omitted → the school's current month. Never a future one, whatever the calendar
   * holds.
   */
  async monthly(
    month?: MonthKey | null,
    teacher?: number | null,
  ): Promise<SupportMonthlyReport> {
    const query: Record<string, string | number> = {};
    if (month) query.month = month;
    if (teacher != null) query.teacher = teacher;
    const r = await api.get(`${BASE}/monthly/`, {
      params: Object.keys(query).length ? query : undefined,
    });
    return r.data as SupportMonthlyReport;
  },

  /** The session-by-session history, filtered and paged. Newest hour first. */
  async sessions(filters: SessionFilters = {}): Promise<SupportSessionsReport> {
    const query = params(filters);
    const r = await api.get(`${BASE}/sessions/`, {
      params: Object.keys(query).length ? query : undefined,
    });
    return r.data as SupportSessionsReport;
  },
};

/**
 * DRF's `detail` when it sent one, otherwise the caller's fallback.
 *
 * These endpoints refuse an unreadable date rather than ignoring it, and say what a date
 * should look like. Showing that sentence is the difference between a page an admin can fix
 * and a page that just says something went wrong.
 */
export function errText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}
