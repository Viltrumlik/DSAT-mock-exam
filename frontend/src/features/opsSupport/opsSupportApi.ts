import api from "@/lib/api";

/**
 * The admin's view of support teaching: who does it, and when they are available.
 *
 * Everything here rides `/api/classes/`, never `/api/journals/` or a new namespace — the
 * admin console is host-guarded and only a handful of prefixes are allowlisted, so a route
 * anywhere else 403s before DRF is reached.
 */

export interface SupportTeacherRow {
  id: number;
  name: string;
  email: string;
  /** "math" | "english" | "both" — "both" is a support teacher's option and nobody else's. */
  subject: string;
  is_active: boolean;
}

/** One weekday of a support teacher's standing schedule. `end_hour` is EXCLUSIVE. */
export interface SupportWorkingDay {
  /** 0 = Monday … 6 = Sunday, matching Python's `date.weekday()`. */
  weekday: number;
  label: string;
  is_working: boolean;
  start_hour: number;
  end_hour: number;
}

export interface SupportWorkingHours {
  support_teacher: { id: number; name: string };
  /** False when nobody has set this teacher up — the days are then platform defaults, and
   *  saying so is the difference between "open 08–18" and "somebody chose 08–18". */
  configured: boolean;
  open_hour: number;
  close_hour: number;
  days: SupportWorkingDay[];
  /** Only on a save: appointments that now sit outside the schedule. Never auto-cancelled —
   *  narrowing a week must not silently call off sessions students are expecting. */
  bookings_outside_schedule?: { booking_id: number; student: string; starts_at: string }[];
}

function rowsOf(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const d = data as { results?: unknown[]; items?: unknown[] } | null;
  return d?.results ?? d?.items ?? [];
}

export const opsSupportApi = {
  /** Every support teacher, whatever subject they cover. */
  async teachers(): Promise<SupportTeacherRow[]> {
    const { data } = await api.get("/users/", { params: { role: "support_teacher" } });
    return rowsOf(data) as SupportTeacherRow[];
  },

  /** One teacher's standing weekly schedule. Always seven days, configured or not. */
  async workingHours(supportTeacherId: number): Promise<SupportWorkingHours> {
    const { data } = await api.get<SupportWorkingHours>("/classes/support/working-hours/", {
      params: { support_teacher: supportTeacherId },
    });
    return data;
  },

  /** Replace the whole week. PUT, not PATCH — see the endpoint's docstring: a per-day write
   *  is how "Tuesday is off" and "no row for Tuesday" drift into meaning different things. */
  async setWorkingHours(
    supportTeacherId: number,
    days: SupportWorkingDay[],
  ): Promise<SupportWorkingHours> {
    const { data } = await api.put<SupportWorkingHours>("/classes/support/working-hours/", {
      support_teacher: supportTeacherId,
      days: days.map((d) => ({
        weekday: d.weekday,
        is_working: d.is_working,
        start_hour: d.start_hour,
        end_hour: d.end_hour,
      })),
    });
    return data;
  },

};
