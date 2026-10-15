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
  "public_student",
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

/** What the admin console calls each role. */
export const ROLE_LABELS: Record<CanonicalRole, string> = {
  student: "Student",
  public_student: "Public student",
  teacher: "Teacher",
  support_teacher: "Support teacher",
  test_admin: "Test admin",
  test_auditor: "Test auditor",
  admin: "Admin",
  super_admin: "Super admin",
};

const norm = (r: unknown) => String(r ?? "").trim().toLowerCase();

/**
 * A learner who signed up on the site and is not (or no longer) at the learning center. They see
 * mock exams and events, plus their profile — nothing else (owner, 2026-10-13). Mirrors
 * `ROLE_PUBLIC_STUDENT`; the backend's host guard is the real gate.
 */
export const isPublicStudent = (r: unknown) => norm(r) === "public_student";

/** Roles whose home is the student site: the learning center's students and public learners. */
export const isStudentSiteRole = (r: unknown) => norm(r) === "student" || isPublicStudent(r);

export const PUBLIC_STUDENT_HOME = "/mock-exam";

/** The runner is `/exam/<id>`; the backend decides which attempts it serves a public learner. */
// "/review": a learner who left reads their own finished results (owner 2026-10-14).
const PUBLIC_STUDENT_PATH_PREFIXES = ["/mock-exam", "/exam", "/events", "/profile", "/review"] as const;

export function isPublicStudentPath(p: string): boolean {
  return PUBLIC_STUDENT_PATH_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
}

/** Where a role lands after signing in, and where the shell sends it home. */
export const homePathFor = (r: unknown) => (isPublicStudent(r) ? PUBLIC_STUDENT_HOME : "/");
