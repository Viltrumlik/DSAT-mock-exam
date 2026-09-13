import { capabilitiesFor, type Capabilities } from "@/features/classroom/capabilities";
import type { RawRole } from "@/features/classroom/types";

/**
 * The classes, from a `GET /api/classes/` list, in which the signed-in user holds `capability`.
 *
 * `my_role` is the membership role as the server stores it: UPPERCASE, with ADMIN for a legacy
 * owner. Read it through `capabilitiesFor`, never as a string. A lowercase comparison matches no
 * role at all and so keeps every class, including one the user only sits in as a student.
 *
 * Pass the capability the endpoint you are about to call checks. A class that fails the check
 * costs a 403 at best, and an endpoint open to every member (the leaderboard) hands back that
 * class's data as though the user taught it.
 */
export function classesWithCapability<C extends { my_role?: RawRole }>(
  classes: readonly C[],
  capability: keyof Capabilities,
): C[] {
  return classes.filter((c) => capabilitiesFor(c.my_role)[capability]);
}
