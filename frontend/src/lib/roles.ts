/**
 * Role sets, mirrored from `backend/access/constants.py`.
 *
 * These exist because the backend's own note about them turned out to be true on this side of
 * the wire too:
 *
 *   > Reference this set instead of comparing to ROLE_TEACHER — a bare `== ROLE_TEACHER` is
 *   > how a new subject-scoped role silently loses its subject rules and falls through to a
 *   > hard deny.
 *
 * `support_teacher` shipped with that set used correctly throughout the backend, and with a
 * bare `role === "teacher"` left in the ops user form. The result was an account the server
 * refuses to create without a subject and a form that never offers one — the role could not
 * be added at all.
 */

/** Every role the platform issues. Mirrors `CANONICAL_ROLES`. */
export const CANONICAL_ROLES = [
  "student",
  "teacher",
  "support_teacher",
  "test_admin",
  "test_auditor",
  "admin",
  "super_admin",
] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number];

/**
 * Staff roles that belong to exactly one domain subject and MUST carry `subject`.
 * Mirrors `SUBJECT_SCOPED_STAFF_ROLES`. Everything else is global scope or subject-less.
 */
export const SUBJECT_SCOPED_STAFF_ROLES: readonly string[] = ["teacher", "support_teacher"];

/** Roles admitted to the teacher portal. Mirrors `TEACHER_PORTAL_ROLES`. */
export const TEACHER_PORTAL_ROLES: readonly string[] = ["teacher", "support_teacher", "super_admin"];

export function requiresSubject(role: string | null | undefined): boolean {
  return SUBJECT_SCOPED_STAFF_ROLES.includes(String(role ?? ""));
}

export function canEnterTeacherPortal(role: string | null | undefined): boolean {
  return TEACHER_PORTAL_ROLES.includes(String(role ?? ""));
}
