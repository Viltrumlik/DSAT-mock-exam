import api, { classesApi } from "@/lib/api";
import type { SupportTeacherCalendar } from "@/lib/api";

/** One support teacher's row on the overview table. */
export interface SupportDeskRow {
  id: number;
  name: string;
  email: string;
  subject: string | null;
  photo_url: string | null;
  classrooms: { id: number; name: string }[];
  /** How many students can actually reach this desk. Counted from ACTIVE student
   *  memberships in the classrooms this teacher covers, de-duplicated — the same filter
   *  the booking path uses, so the number agrees with who can really book. */
  students: number;
  held: number;
  missed: number;
  cancelled: number;
  upcoming: number;
  /** Hours that have passed with no outcome recorded. Nobody has been paid for these. */
  awaiting_settle: number;
  free_hours: number;
  closed_hours: number;
  ratings: { average: number | null; count: number };
}

export interface SupportDeskOverview {
  days: number;
  open_hour: number;
  close_hour: number;
  teachers: SupportDeskRow[];
}

export interface SupportRatingRow {
  booking_id: number;
  rating: number;
  comment: string;
  rated_at: string | null;
  student: string;
  student_id: number;
  classroom_name: string | null;
  starts_at: string;
  topic: string;
  teacher_note: string;
}

export interface SupportRatingFeed {
  support_teacher_id: number;
  support_teacher: string;
  summary: { average: number | null; count: number };
  ratings: SupportRatingRow[];
}

/**
 * Administrator reads over the support desk.
 *
 * The week and the diary deliberately go through `classesApi` rather than being re-declared
 * here: an admin looking at a teacher's grid must see the same grid the teacher sees, and
 * two client functions against one endpoint is how they come to differ.
 */
export const supportAdminApi = {
  async overview(): Promise<SupportDeskOverview> {
    const { data } = await api.get("/classes/support/desks/");
    return {
      days: data?.days ?? 4,
      open_hour: data?.open_hour ?? 8,
      close_hour: data?.close_hour ?? 18,
      teachers: (data?.teachers ?? []) as SupportDeskRow[],
    };
  },

  async ratings(supportTeacherId: number): Promise<SupportRatingFeed> {
    const { data } = await api.get("/classes/support/ratings/", {
      params: { support_teacher: supportTeacherId },
    });
    return {
      support_teacher_id: data?.support_teacher_id ?? supportTeacherId,
      support_teacher: data?.support_teacher ?? "",
      summary: data?.summary ?? { average: null, count: 0 },
      ratings: (data?.ratings ?? []) as SupportRatingRow[],
    };
  },

  week(supportTeacherId: number): Promise<SupportTeacherCalendar> {
    return classesApi.supportMyCalendar(supportTeacherId);
  },

  setHour(
    supportTeacherId: number,
    action: "close" | "open",
    startsAt: string,
    body?: { capacity?: number; note?: string },
  ) {
    return classesApi.supportSetHour(action, startsAt, {
      ...body,
      support_teacher: supportTeacherId,
    });
  },
};
