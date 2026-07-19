/**
 * Lesson plan for one classroom — the teacher's view of the Journal for its course.
 *
 * Routes live under /api/classes/ (not /api/journals/): the journals namespace is
 * host-guarded to the admin subdomain and its permission class excludes teachers.
 */

import api from "@/lib/api";

export type LessonBlock = "HOMEWORK" | "NEW_TOPIC" | "EXERCISES" | "MIDTERM";
export type LessonResourceType = "assessment_set" | "practice_test" | "practice_test_pack";

export interface LessonGrant {
  id: number;
  block: LessonBlock;
  resource_type: LessonResourceType;
  resource_id: number;
  granted_at: string;
}

/** One item in a classwork block that the teacher can open to the class. */
export interface LessonItem {
  resource_type: LessonResourceType;
  resource_id: number;
  block: LessonBlock;
  title?: string;
  question_count?: number | null;
  given: boolean;
}

export interface LessonMidterm {
  exam_id: number;
  title: string;
  access_days_before: number;
  granted: boolean;
  /** Access alone does not let students in — the teacher must also start it. */
  has_start_code: boolean;
  /** The 6-digit code itself, so it survives navigating away mid-lesson. */
  start_code: string;
  starts_at: string | null;
}

export interface LessonRow {
  lesson_id: number;
  lesson_number: number;
  lesson_type: "HOMEWORK" | "MIDTERM";
  title: string;
  scheduled_for: string | null;
  is_ready: boolean;
  homework_ready: boolean;
  classwork_ready: boolean;
  homework_released: boolean;
  homework_released_at: string | null;
  assignment_id: number | null;
  grants: LessonGrant[];
  midterm?: LessonMidterm | null;
}

export interface LessonDetail extends LessonRow {
  homework: {
    instructions: string;
    external_url: string;
    allow_file_upload: boolean;
    practice_test_ids: number[];
    practice_test_pack_ids: number[];
    assessments: { resource_type: "assessment_set"; resource_id: number; title: string }[];
    validation: string[];
  };
  classwork?: {
    timetable: { key: string; label: string; minutes: number }[];
    total_minutes: number;
    new_topic: { title: string; instructions: string; external_url: string; minutes: number; items: LessonItem[] };
    exercises: { minutes: number; items: LessonItem[] };
    homework_review_minutes: number;
    break_minutes: number;
    revision: { minutes: number; notes: string };
    validation: string[];
  };
}

export interface LessonPlan {
  bound: boolean;
  /** Why there is no plan, so the UI can tell the teacher what to ask an admin for. */
  reason: "" | "no_level" | "no_published_journal";
  journal: { id: number; title: string; subject: string; level: string } | null;
  starts_on?: string | null;
  lessons: LessonRow[];
}

const base = (classId: number) => `/classes/${classId}/lessons/`;

export const lessonsApi = {
  plan: async (classId: number): Promise<LessonPlan> => (await api.get(base(classId))).data,

  detail: async (classId: number, lessonId: number): Promise<LessonDetail> =>
    (await api.get(`${base(classId)}${lessonId}/`)).data,

  release: async (classId: number, lessonId: number, allowUnapproved = false) =>
    (await api.post(`${base(classId)}${lessonId}/release/`,
      allowUnapproved ? { allow_unapproved: true } : {})).data,

  grant: async (
    classId: number,
    lessonId: number,
    body: { block: LessonBlock; resource_type: LessonResourceType; resource_id: number },
    allowUnapproved = false,
  ) => (await api.post(`${base(classId)}${lessonId}/grant/`,
    allowUnapproved ? { ...body, allow_unapproved: true } : body)).data,

  /** A midterm session grants the whole exam — no per-item body. */
  grantMidterm: async (classId: number, lessonId: number) =>
    (await api.post(`${base(classId)}${lessonId}/grant/`, {})).data,

  revoke: async (classId: number, lessonId: number, grantId: number) =>
    (await api.post(`${base(classId)}${lessonId}/grants/${grantId}/revoke/`, {})).data,

  reschedule: async (classId: number, startsOn: string) =>
    (await api.patch(`${base(classId)}reschedule/`, { starts_on: startsOn })).data,
};
