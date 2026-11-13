import { CANONICAL_ROLES, type CanonicalRole } from "@/lib/roles";

/**
 * What the signed-in person may do in the admin console, read from `me.permissions` (GET /users/me/).
 *
 * The server decides every request (`access.permissions.Requires` on each CRM endpoint, plan
 * 2026-11-12-crm-roles); this only keeps the console from offering a page or a button the server would
 * refuse. A role is a preset of permissions and the owner can tick one on or off for one person, so the
 * console reads the permissions and never the role name. `*` (the owner) holds everything.
 */

/** `useMe` types the payload as an open record, so the fields are narrowed here. */
export type MeLike = Record<string, unknown> | null | undefined;

/** The CRM's permissions (`access/constants.py`), plus the two user-management ones the people pages use. */
export const P = {
  viewPeople: "view_people",
  editPeople: "edit_people",
  viewMoney: "view_money",
  takePayment: "take_payment",
  voidPayment: "void_payment",
  adjustBalance: "adjust_balance",
  setPrices: "set_prices",
  debtFreeze: "debt_freeze",
  enroll: "enroll",
  manageSeats: "manage_seats",
  manageGroups: "manage_groups",
  sendSms: "send_sms",
  sendDebtSms: "send_debt_sms",
  viewReports: "view_reports",
  eventsShop: "events_shop",
  manageStaff: "manage_staff",
  lcupTools: "lcup_tools",
  manageUsers: "manage_users",
  assignAccess: "assign_access",
} as const;

export type Permission = (typeof P)[keyof typeof P];

/** The 17 CRM permissions. Holding any one of them makes a person part of the desk. */
export const CRM_PERMISSIONS: readonly Permission[] = [
  P.viewPeople, P.editPeople, P.viewMoney, P.takePayment, P.voidPayment, P.adjustBalance, P.setPrices,
  P.debtFreeze, P.enroll, P.manageSeats, P.manageGroups, P.sendSms, P.sendDebtSms, P.viewReports,
  P.eventsShop, P.manageStaff, P.lcupTools,
];

function permissionsOf(me: MeLike): readonly string[] {
  const raw = me?.permissions;
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
}

/** Whether `me` holds ANY of the codenames. With none given, nothing is asked, so it is true. */
export function holds(me: MeLike, ...codes: readonly string[]): boolean {
  const held = permissionsOf(me);
  if (held.includes("*")) return true;
  return codes.length === 0 || codes.some((code) => held.includes(code));
}

/** The owner: super_admin, a Django superuser, or anyone holding `*`. */
export function isOwner(me: MeLike): boolean {
  if (!me) return false;
  const role = String(me.role ?? "").trim().toLowerCase();
  return role === "super_admin" || Boolean(me.is_superuser) || permissionsOf(me).includes("*");
}

/** Someone who works the desk: holds a CRM permission and is not the owner (today the administrator). */
export function isDeskViewer(me: MeLike): boolean {
  return !isOwner(me) && CRM_PERMISSIONS.some((code) => permissionsOf(me).includes(code));
}

/** Mirrors `UserSerializer._ROLE_RANK`. An unknown role counts as a student, as the server's does. */
const ROLE_RANK: Record<CanonicalRole, number> = {
  student: 1,
  public_student: 1,
  teacher: 2,
  support_teacher: 2,
  test_admin: 3,
  test_auditor: 3,
  accountant: 3,
  admin: 3,
  super_admin: 4,
};

const LEARNER_ROLES: readonly string[] = ["student", "public_student"];

/** Anyone but a learner: staff accounts are managed with `manage_staff`, which only the owner holds. */
export function isStaffRole(role: unknown): boolean {
  return !LEARNER_ROLES.includes(String(role ?? "").trim().toLowerCase());
}

function rankOfRole(role: unknown): number {
  return ROLE_RANK[String(role ?? "").trim().toLowerCase() as CanonicalRole] ?? 1;
}

function myRank(me: MeLike): number {
  return isOwner(me) ? ROLE_RANK.super_admin : rankOfRole(me?.role);
}

/**
 * Whether `me` may change this account: edit it, freeze it, delete it, sign it out or give it a one-time
 * password. Mirrors `users/account_rank.py`: user management (`manage_users`); a staff account only with
 * `manage_staff`; and the account ranked strictly below yours. The owner changes any. So an administrator
 * manages learners, never staff.
 */
export function mayChangeAccount(me: MeLike, targetRole: unknown): boolean {
  if (!holds(me, P.manageUsers)) return false;
  if (isOwner(me)) return true;
  if (isStaffRole(targetRole) && !holds(me, P.manageStaff)) return false;
  return rankOfRole(targetRole) < myRank(me);
}

/**
 * The roles `me` may give: none ranked above their own (`UserSerializer.validate_role`), and a staff role only
 * with `manage_staff`.
 */
export function rolesYouMayGive(me: MeLike): CanonicalRole[] {
  const mine = myRank(me);
  const staff = holds(me, P.manageStaff);
  return CANONICAL_ROLES.filter((role) => ROLE_RANK[role] <= mine && (staff || !isStaffRole(role)));
}
