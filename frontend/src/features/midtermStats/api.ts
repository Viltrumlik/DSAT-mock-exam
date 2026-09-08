/**
 * Client for the read-only admin midterm statistics API (`/api/midterms/admin/stats/`).
 *
 * Two calls, two surfaces: one month of the whole school, and one classroom's month.
 * Every URL in this feature lives here — `scripts/check-api-layer.sh`
 * fails the build if a request string appears anywhere else.
 */
import api from "@/lib/api";
import type { ClassroomMonth, MonthKey, MonthlyStats } from "./types";

const BASE = "/midterms/admin/stats";

/**
 * There is a fourth endpoint, `GET .../stats/months/`, and nothing here calls it on purpose:
 * the monthly payload already carries the same `months` list, so the page draws its picker
 * and its tables from one response instead of racing two.
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
