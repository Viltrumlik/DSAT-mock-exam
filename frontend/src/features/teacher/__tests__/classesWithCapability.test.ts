import { describe, expect, it } from "vitest";
import { classesWithCapability } from "../classesWithCapability";

/**
 * The filter the teacher portal's hooks share. Their own tests cover the five roles the server
 * sends; this pins what else can turn up in `my_role`, and that the capability named is the one
 * applied.
 */
describe("classesWithCapability", () => {
  const rows = [
    { id: 1, my_role: "OWNER" },
    { id: 2, my_role: "ADMIN" },
    { id: 3, my_role: "TEACHER" },
    { id: 4, my_role: "TA" },
    { id: 5, my_role: "STUDENT" },
    { id: 6, my_role: null },
    { id: 7 },
    { id: 8, my_role: "REMOVED" },
    { id: 9, my_role: "SOMETHING_NEW" },
    { id: 10, my_role: "CO_TEACHER" },
  ];

  it("keeps the teaching team, legacy CO_TEACHER included, and drops students, non-members and unknown roles", () => {
    expect(classesWithCapability(rows, "canViewClassAnalytics").map((c) => c.id)).toEqual([1, 2, 3, 4, 10]);
    expect(classesWithCapability(rows, "canGrade").map((c) => c.id)).toEqual([1, 2, 3, 4, 10]);
  });

  it("applies the capability it is given", () => {
    // A TA grades, but managing the roster is for the owner and teachers.
    expect(classesWithCapability(rows, "canManageRoster").map((c) => c.id)).toEqual([1, 2, 3]);
  });
});
