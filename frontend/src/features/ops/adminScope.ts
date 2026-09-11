/**
 * What an `admin` sees in the ops console.
 *
 * The school's list, verbatim: Dashboard, Classrooms, Branches, Support, Shop, Access and
 * Users. Everything else in the console — Journals, Midterms, Mock sittings, Surveys,
 * Stories, Exam dates, and the old Assignments notice — is not shown to an admin at all,
 * neither in the sidebar nor by typing its address.
 *
 * Scoped to the `admin` ROLE and nothing wider. Teachers and test auditors can also open
 * this console and see all of it; the school asked about admins, so nobody else's view
 * moves. A Django superuser whose role field happens to read "admin" carries the "*"
 * permission, and the wildcard wins — the server treats them as a super admin, so does
 * this.
 *
 * This hides pages; it revokes nothing. The APIs behind the hidden sections admit an admin
 * exactly as they did before.
 */
export const ADMIN_OPS_SECTIONS: readonly string[] = [
  "/ops",
  "/ops/classrooms",
  "/ops/branches",
  "/ops/support",
  "/ops/shop",
  "/ops/access",
  "/ops/users",
];

/** `useMe` types the payload as an open record, so the fields are narrowed here. */
type MeLike = Record<string, unknown> | null | undefined;

/** An `admin` who is not a superuser — the one account this scope applies to. */
export function isScopedOpsAdmin(me: MeLike): boolean {
  if (!me) return false;
  const role = String(me.role ?? "").trim().toLowerCase();
  const permissions = Array.isArray(me.permissions) ? me.permissions : [];
  return role === "admin" && !permissions.includes("*");
}

/**
 * Whether an ops path belongs to one of the admin's sections. The dashboard matches only
 * itself — every ops page sits under `/ops`, so a prefix match there would let them all
 * through.
 */
export function isAdminOpsPath(pathname: string): boolean {
  return ADMIN_OPS_SECTIONS.some((href) =>
    href === "/ops" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`),
  );
}
