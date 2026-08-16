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

export interface SupportHour {
  /** ISO start of the hour. */
  starts_at: string;
  /** "open" | "closed" | "booked" — the grid's three states. */
  state: string;
  capacity?: number;
  note?: string;
  bookings?: { id: number; student: string; topic: string; status: string }[];
}

export interface SupportWeek {
  support_teacher: { id: number; name: string };
  open_hour: number;
  close_hour: number;
  free_hours: number;
  booked_sessions: number;
  days_out: { date: string; hours: SupportHour[] }[];
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

  /** One teacher's week. Omitting the id would return the ADMIN's own empty week. */
  async week(supportTeacherId: number): Promise<SupportWeek> {
    const { data } = await api.get<SupportWeek>("/classes/support/my-calendar/", {
      params: { support_teacher: supportTeacherId },
    });
    return data;
  },

  /** Withdraw or re-open one hour on a teacher's calendar. */
  async setHour(input: {
    supportTeacherId: number;
    startsAt: string;
    action: "open" | "close";
    capacity?: number;
    note?: string;
  }): Promise<void> {
    await api.post(`/classes/support/hours/${input.action}/`, {
      support_teacher: input.supportTeacherId,
      starts_at: input.startsAt,
      ...(input.capacity != null ? { capacity: input.capacity } : {}),
      ...(input.note != null ? { note: input.note } : {}),
    });
  },
};
