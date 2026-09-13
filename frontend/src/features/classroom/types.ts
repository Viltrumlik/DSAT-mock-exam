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
