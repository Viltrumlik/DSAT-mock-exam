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
};

/** Submission workflow states — mirror of backend classes.submission_state. */
export type SubmissionStatus = "DRAFT" | "SUBMITTED" | "RETURNED" | "REVIEWED";

export interface Member {
  id: number;
  user: { id: number; email: string; first_name?: string; last_name?: string; username?: string };
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

/** Teacher interventions from GET /classes/{id}/interventions/. */
export interface Interventions {
  overdue?: InterventionRow[];
  inactive?: InterventionRow[];
  low_scores?: InterventionRow[];
  completion_rate?: number | null;
}

export interface InterventionRow {
  user?: { id: number; first_name?: string; last_name?: string; email?: string };
  assignment?: { id: number; title: string };
  detail?: string;
  value?: number | string;
}
