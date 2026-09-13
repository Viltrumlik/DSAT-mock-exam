/**
 * Client for the read-only admin midterm statistics API (`/api/midterms/admin/stats/`).
 *
 * Two calls, two surfaces: one month of the whole school, and one classroom's month.
 * Every URL in this feature lives here — `scripts/check-api-layer.sh`
 * fails the build if a request string appears anywhere else.
 */
import api from "@/lib/api";
import { downloadBlob } from "@/lib/download";
import type { BranchOption, ClassroomMonth, MonthKey, MonthlyStats, TrendPoint } from "./types";

const BASE = "/midterms/admin/stats";
const REPORTS = "/midterms/admin/reports";

/**
 * There is a fourth endpoint, `GET .../stats/months/`, and nothing here calls it on purpose:
 * the monthly payload already carries the same `months` list, so the page draws its picker
 * and its tables from one response instead of racing two.
 *
 * Its `current` — the month to open on — reaches this feature as the monthly payload's own
 * `month`, and both are `null` under exactly the same condition: every month the scope has is
 * still ahead of it, so there is no month with results to default to. `null` there is never an
 * empty school; `future_months` beside it says what is coming, and the page says so.
 */
export const midtermStatsApi = {
  /**
   * One month of the whole school: totals, then branches, departments, teachers, classes.
   *
   * `month` omitted → the backend opens on the newest month that has data, which is not
   * today's for most of any month.
   */
  async monthly(month?: MonthKey | null): Promise<MonthlyStats> {
    const r = await api.get(`${BASE}/monthly/`, { params: month ? { month } : undefined });
    return r.data as MonthlyStats;
  },

  /** One classroom's month: a row per paper it sat, plus the pooled summary over them. */
  async classroom(classroomId: number, month?: MonthKey | null): Promise<ClassroomMonth> {
    const r = await api.get(`${BASE}/classrooms/${classroomId}/`, {
      params: month ? { month } : undefined,
    });
    return r.data as ClassroomMonth;
  },

  /**
   * The pass rate month by month, for the trend line.
   *
   * Its own request rather than a key on the monthly payload: it costs the server one month
   * computation per point, and the page must draw its first number without waiting on a
   * year of them. Fetched beside the month; a failure leaves the chart out, never the page.
   */
  async trend(): Promise<TrendPoint[]> {
    const r = await api.get(`${BASE}/trend/`);
    return (r.data?.results ?? []) as TrendPoint[];
  },

  /** The branches a whole-branch PDF can be asked for. */
  async branches(): Promise<BranchOption[]> {
    const r = await api.get(`${REPORTS}/branches/`);
    return (r.data?.results ?? []) as BranchOption[];
  },

  /**
   * The whole branch as one PDF: departments, teachers, classes and every student.
   *
   * `branchId: 0` is the whole school — the endpoint reads it that way, so a school with a
   * single branch does not have to pick one from a list of one.
   */
  async downloadBranchPdf(branchId: number, month: MonthKey | null, name: string): Promise<void> {
    const r = await api.get(`${REPORTS}/branches/${branchId}/pdf/`, {
      params: month ? { month } : undefined,
      responseType: "blob",
    });
    const slug = (name || "branch").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    downloadBlob(r.data as Blob, `midterm-report-${slug}-${month ?? "latest"}.pdf`);
  },
};

/**
 * DRF's `detail` when it sent one, otherwise the caller's fallback.
 *
 * The stats endpoints answer a mistyped month or filter with a 400 that says what was
 * expected; showing that sentence is the difference between a page an admin can fix and a
 * page that just says something went wrong.
 */
export function errText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}
