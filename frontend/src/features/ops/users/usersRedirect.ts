import { CANONICAL_ROLES } from "@/lib/roles";

/**
 * Where an old `/ops/users` address goes now that the list is three (2026-10-14): bookmarks and
 * the dashboard's old `?kind=` / `?role=` links land on the matching new list.
 */
export function usersRedirectTarget(search: string): string {
  const params = new URLSearchParams(search);
  const kind = (params.get("kind") ?? "").trim().toLowerCase();
  const role = (params.get("role") ?? "").trim().toLowerCase();

  if (kind === "public") return "/ops/public";
  if (kind === "frozen_debt" || kind === "frozen_admin") return `/ops/students?status=${kind}`;
  if (kind === "centre") return "/ops/students";

  if (role === "public_student") return "/ops/public";
  if (role && role !== "student" && (CANONICAL_ROLES as readonly string[]).includes(role)) {
    return `/ops/staff?role=${encodeURIComponent(role)}`;
  }
  return "/ops/students";
}
