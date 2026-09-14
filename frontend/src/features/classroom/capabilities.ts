/**
 * Role → capability mapping. Permissions are derived here, never hardcoded as
 * string comparisons in components. Forward-compatible with the rebuild role model
 * (OWNER/TEACHER/TA/STUDENT) while still understanding legacy ADMIN/CO_TEACHER.
 */

import type { MembershipRole, RawRole } from "./types";

/** Map any raw/legacy role onto the canonical rebuild role model. */
export function normalizeRole(raw: RawRole): MembershipRole | null {
  switch (raw) {
    case "OWNER":
      return "OWNER";
    case "ADMIN": // legacy classroom admin == owner/teacher
      return "OWNER";
    case "TEACHER":
      return "TEACHER";
    case "CO_TEACHER":
    case "TA":
      return "TA";
    case "STUDENT":
      return "STUDENT";
    default:
      return null; // REMOVED / unknown → no membership capabilities
  }
}

const STAFF: ReadonlySet<MembershipRole> = new Set(["OWNER", "TEACHER", "TA"]);

export interface Capabilities {
  isMember: boolean;
  isStaff: boolean; // TA + Teacher + Owner
  isStudent: boolean;
  isOwner: boolean;
  // Instructional — TA + Teacher + Owner
  canManageAssignments: boolean; // create/edit/publish/archive (NOT delete)
  canGrade: boolean;
  canTakeAttendance: boolean;
  canPostAnnouncement: boolean;
  canViewClassAnalytics: boolean;
  canRecomputeRanking: boolean;
  // Governance — Teacher + Owner
  canManageClass: boolean; // settings, deactivate, join code
  canDeleteAssignment: boolean;
  canManageRoster: boolean; // add/remove students
  canConfigureRanking: boolean; // weights + visibility
  // Owner only
  canAssignTa: boolean;
  canDeleteClass: boolean;
}

export function capabilitiesFor(raw: RawRole): Capabilities {
  const role = normalizeRole(raw);
  const isMember = role != null;
  const isStaff = role != null && STAFF.has(role);
  const isStudent = role === "STUDENT";
  const isManager = role === "OWNER" || role === "TEACHER";
  const isOwner = role === "OWNER";
  return {
    isMember,
    isStaff,
    isStudent,
    isOwner,
    canManageAssignments: isStaff,
    canGrade: isStaff,
    canTakeAttendance: isStaff,
    canPostAnnouncement: isStaff,
    canViewClassAnalytics: isStaff,
    canRecomputeRanking: isStaff,
    canManageClass: isManager,
    canDeleteAssignment: isManager,
    canManageRoster: isManager,
    canConfigureRanking: isManager,
    canAssignTa: isOwner,
    canDeleteClass: isOwner,
  };
}

/**
 * What a member of the teaching team is called — on the People page and in the class header.
 *
 * Named after the person's ACCOUNT, never the membership. The membership role is a permission
 * tier, not a job title, and read as one it was wrong almost everywhere: an ownership transfer
 * demotes the admin who made the class to TEACHER and promotes the class's teacher to OWNER,
 * and a support teacher joins as a TA. On 2026-09-13 prod titled 13 teacher memberships "Owner",
 * 10 admin memberships and 6 super_admin memberships "Teacher", and 21 support-teacher
 * memberships "Teaching Assistant". The owner's correction is one title per account role — and
 * the learning center's owner is the super_admin, so "Owner" is that account's title alone.
 *
 * Four titles, the four the owner named. There is no "Teaching assistant": the learning center
 * has no such job, and a TA membership is how a support teacher sits on a class.
 *
 * A label only. What a member may DO still comes from the membership, via `capabilitiesFor`.
 */
export type StaffTitle = "Owner" | "Admin" | "Teacher" | "Support teacher";

/** The order the teaching team is listed in: the owner first, then down the house. */
export const STAFF_TITLE_ORDER: readonly StaffTitle[] = ["Owner", "Admin", "Teacher", "Support teacher"];

export function staffTitle(membershipRole: RawRole, accountRole?: string | null): StaffTitle | null {
  const role = normalizeRole(membershipRole);
  if (role == null || role === "STUDENT") return null;
  switch (String(accountRole ?? "").trim().toLowerCase()) {
    case "super_admin":
      return "Owner";
    case "admin":
      return "Admin";
    case "teacher":
      return "Teacher";
    case "support_teacher":
      return "Support teacher";
  }
  // An account whose role names no staff job is titled by the seat its membership gives it.
  // In prod every such TA is support staff whose account has since been set back to student
  // (working hours, availability and settled bookings all say support teacher). Never "Owner",
  // whatever the membership says: that title belongs to the super_admin.
  return role === "TA" ? "Support teacher" : "Teacher";
}

/** `staffTitle`, or "Student" for a student membership — the class header's "· <title>". */
export function memberTitle(membershipRole: RawRole, accountRole?: string | null): string | null {
  return normalizeRole(membershipRole) === "STUDENT" ? "Student" : staffTitle(membershipRole, accountRole);
}
