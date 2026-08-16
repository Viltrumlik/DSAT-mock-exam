/**
 * Lesson plan for one classroom — the teacher's view of the Journal for its course.
 *
 * Routes live under /api/classes/ (not /api/journals/): the journals namespace is
 * host-guarded to the admin subdomain and its permission class excludes teachers.
 */

import api from "@/lib/api";

export type LessonBlock = "HOMEWORK" | "NEW_TOPIC" | "EXERCISES" | "MIDTERM";
export type LessonResourceType = "assessment_set" | "practice_test" | "practice_test_pack" | "vocabulary_set";

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
  word_count?: number;
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
  /** Classwork has its own carrier — `homework_released` says nothing about it. */
  classwork_given: boolean;
  classwork_assignment_id: number | null;
  grants: LessonGrant[];
  midterm?: LessonMidterm | null;
}

export interface LessonDetail extends LessonRow {
  homework: {
    instructions: string;
    external_url: string;
    external_urls: string[];
    video_url: string;
    video_file_url: string | null;
    allow_file_upload: boolean;
    practice_test_ids: number[];
    practice_test_pack_ids: number[];
    assessments: { resource_type: "assessment_set"; resource_id: number; title: string }[];
    vocabulary: { resource_id: number; title: string; word_count: number }[];
    validation: string[];
  };
  classwork?: {
    timetable: { key: string; label: string; minutes: number }[];
    total_minutes: number;
    new_topic: { title: string; instructions: string; external_url: string; external_urls: string[]; video_url: string; video_file_url: string | null; minutes: number; items: LessonItem[] };
    exercises: { minutes: number; items: LessonItem[] };
    homework_review_minutes: number;
    break_minutes: number;
    revision: { minutes: number; notes: string };
    validation: string[];
  };
}

/** What a teacher has already recorded for one student on one lesson's classwork. */
export interface ClassworkAward {
  student_id: number;
  points: number;
  xp: number;
  awarded_at: string;
  note: string;
}

/** Teacher-facing state of one lesson's classwork carrier. */
export interface LessonClasswork {
  /** False until the teacher hands it out — the carrier does not exist before that. */
  given: boolean;
  assignment_id: number | null;
  title: string;
  given_at: string | null;
  /** Server-side ceiling on one award; the points field is bounded by it, not by a local constant. */
  max_points: number;
  awards: ClassworkAward[];
}

export type LessonFocus = "today" | "next" | "last" | "undated";

export interface LessonPlan {
  bound: boolean;
  /** The one lesson the panel opens on — resolved server-side, no picker. */
  focus_lesson_id?: number | null;
  focus?: LessonFocus;
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

  /** Read the classwork carrier's state + every award already recorded. Staff-readable. */
  classwork: async (classId: number, lessonId: number): Promise<LessonClasswork> =>
    (await api.get(`${base(classId)}${lessonId}/classwork/`)).data,

  /** Hand this lesson's classwork to the class. Idempotent; manager-only server-side. */
  assignClasswork: async (
    classId: number,
    lessonId: number,
  ): Promise<LessonClasswork & { detail?: string; created?: boolean }> =>
    (await api.post(`${base(classId)}${lessonId}/classwork/`, {})).data,

  /**
   * Record one student's classwork points. Manager-only server-side (OWNER + TEACHER):
   * classwork points are minted rather than derived from work, so a TA must not reach this.
   *
   * Re-awarding the same student CORRECTS the figure in place — there is one award per
   * (lesson, student), not one per press.
   */
  awardClasswork: async (
    classId: number,
    lessonId: number,
    body: { student_id: number; points: number; note?: string },
  ): Promise<{ detail: string; student_id: number; points: number; xp: number; awarded_at: string }> =>
    (await api.post(`${base(classId)}${lessonId}/classwork/award/`, body)).data,

  reschedule: async (classId: number, startsOn: string) =>
    (await api.patch(`${base(classId)}reschedule/`, { starts_on: startsOn })).data,
};
