/**
 * Classroom feature — domain types for the rebuilt classroom workspace.
 *
 * The backend currently emits membership roles ADMIN | STUDENT. The rebuild
 * introduces a richer role model (OWNER | TEACHER | TA | STUDENT); this union is
 * forward-compatible and `normalizeRole` maps legacy values until the backend
 * migration lands. Capability checks live in ./capabilities — never compare role
 * strings inline in components.
 */

import type { Classroom } from "@/lib/criticalApiContract";

export type { Classroom };

/** Rebuild role model (superset of the legacy ADMIN/STUDENT). */
export type MembershipRole = "OWNER" | "TEACHER" | "TA" | "STUDENT";

/** Raw role as it may arrive from the API today or after migration. */
export type RawRole = MembershipRole | "ADMIN" | "CO_TEACHER" | "REMOVED" | string | null | undefined;

export type ClassroomWithRole = Classroom & {
  my_role?: RawRole;
  subject?: string;
  /** Difficulty tier; see lib/levels. Blank on untagged classes. */
  level?: string;
  student_count?: number;
  members_count?: number;
  join_code?: string;
  /** Where the class meets, and the room. Both come off the serializer. */
  room_number?: string;
  /** Invite link for the class Telegram group, or "" when nobody has set one. */
  telegram_group_url?: string;
};

/** Submission workflow states — mirror of backend classes.submission_state. */
export type SubmissionStatus = "DRAFT" | "SUBMITTED" | "RETURNED" | "REVIEWED";

export interface Member {
  id: number;
  user: {
    id: number;
    email: string;
    first_name?: string;
    last_name?: string;
    username?: string;
    /** Absolute URL of the profile photo; null when the student has not uploaded one. */
    profile_image_url?: string | null;
  };
  role: RawRole;
  joined_at?: string;
}

/** Student workspace slices from GET /classes/{id}/student-workspace/. */
export interface StudentWorkspace {
  your_assignments?: WorkspaceAssignment[];
  due_soon?: WorkspaceAssignment[];
  recently_graded?: RecentlyGraded[];
  new_posts?: { id: number; content: string; created_at: string; author?: { first_name?: string; last_name?: string } }[];
}

export interface WorkspaceAssignment {
  id: number;
  title: string;
  due_at?: string | null;
  workflow_status?: SubmissionStatus | null;
  assessment_homework?: unknown | null;
  classroom_id?: number;
  classroom_name?: string;
}

export interface RecentlyGraded {
  assignment?: { id?: number; title?: string };
  submission_id?: number | null;
  grade?: string | number | null;
  score?: string | number | null;
  assessment_result?: unknown;
  graded_at?: string | null;
}

/**
 * Teacher interventions from GET /classes/{id}/interventions/ (`ClassroomViewSet.interventions`).
 * `classesApi.getInterventions` returns the body unmapped, so this is the server's shape verbatim.
 */
export interface Interventions {
  /** At least one past-due assignment not turned in; most missing first. */
  overdue_students: (InterventionStudent & { overdue_count: number; oldest_overdue_due_at: string | null })[];
  /** No submission or attempt in 7 days; both fields are null for a student who has never had one. */
  inactive_students: (InterventionStudent & { last_activity_at: string | null; days_inactive: number | null })[];
  /** Average assessment score below 60%; lowest first. */
  low_score_students: (InterventionStudent & { avg_score_pct: number })[];
  completion_summary: InterventionAssignment[];
  class_stats: {
    student_count: number;
    assignment_count: number;
    /** 0–100, already a percentage. Also 0 when nothing is assigned. */
    overall_completion_pct: number;
    avg_assessment_score_pct: number | null;
  };
}

/** A student as each list in `Interventions` describes them. */
export interface InterventionStudent {
  student_id: number;
  email: string;
  first_name: string;
  last_name: string;
  profile_image_url: string | null;
}

export interface InterventionAssignment {
  assignment_id: number;
  title: string;
  due_at: string | null;
  is_overdue: boolean;
  is_assessment: boolean;
  submitted_count: number;
  student_count: number;
  /** 0–100. */
  completion_pct: number;
}
