/**
 * The teaching team is titled by ACCOUNT role, and the membership only fills in when the
 * account names no staff job.
 *
 * A pair with a count beside it exists in production — counted on 2026-09-13, when the People
 * page read the membership instead and showed teachers as "Owner", admins as "Teacher", and the
 * support teacher as "Teaching Assistant". The owner's rule: a teacher is a Teacher, an admin is
 * an Admin, a support teacher is a Support teacher, and the super_admin is the Owner.
 */
import { describe, expect, it } from "vitest";

import { memberTitle, STAFF_TITLE_ORDER, staffTitle } from "../capabilities";

describe("staffTitle", () => {
  it.each([
    // [membership, account, title] — trailing count: memberships of that shape in prod
    ["OWNER", "teacher", "Teacher"], // 13 — the teacher an ownership transfer promoted
    ["TEACHER", "teacher", "Teacher"], // 18
    ["TEACHER", "admin", "Admin"], // 10 — the admin the same transfer demoted
    ["ADMIN", "admin", "Admin"], // 8 — the admin who created the class
    ["TEACHER", "super_admin", "Owner"], // 6
    ["ADMIN", "super_admin", "Owner"], // 3
    ["TA", "support_teacher", "Support teacher"], // 21
    ["OWNER", "support_teacher", "Support teacher"], // 2
  ] as const)("a %s membership on a %s account is titled %s", (membership, account, title) => {
    expect(staffTitle(membership, account)).toBe(title);
  });

  it.each([
    // Accounts whose role names no staff job: titled by the seat the membership gives them.
    ["TA", "student", "Support teacher"], // 21 — support staff whose account was set back to student
    ["TEACHER", "student", "Teacher"], // 14
    ["ADMIN", "student", "Teacher"], // 2
    ["TEACHER", "test_admin", "Teacher"],
    ["TA", undefined, "Support teacher"], // a payload from before the account role was sent
    ["OWNER", null, "Teacher"],
  ] as const)("a %s membership on a %s account falls back to %s", (membership, account, title) => {
    expect(staffTitle(membership, account)).toBe(title);
  });

  it("never calls anyone but the super_admin the Owner", () => {
    for (const membership of ["OWNER", "ADMIN", "TEACHER", "TA", "CO_TEACHER"]) {
      for (const account of ["teacher", "admin", "support_teacher", "student", "test_admin", "", undefined]) {
        expect(staffTitle(membership, account)).not.toBe("Owner");
      }
    }
  });

  it("reads the account role the way the backend spells it, whatever the casing", () => {
    expect(staffTitle("TEACHER", "  Super_Admin ")).toBe("Owner");
    expect(staffTitle("TA", "SUPPORT_TEACHER")).toBe("Support teacher");
  });

  it("gives no staff title to a student, a removed member, or a non-member", () => {
    expect(staffTitle("STUDENT", "super_admin")).toBeNull();
    expect(staffTitle("REMOVED", "teacher")).toBeNull();
    expect(staffTitle(null, "admin")).toBeNull();
  });

  it("has the four titles the owner named, listed from the top", () => {
    expect(STAFF_TITLE_ORDER).toEqual(["Owner", "Admin", "Teacher", "Support teacher"]);
  });
});

describe("memberTitle", () => {
  it("is the staff title for staff and 'Student' for a student membership", () => {
    expect(memberTitle("OWNER", "teacher")).toBe("Teacher");
    expect(memberTitle("TEACHER", "super_admin")).toBe("Owner");
    // The student site forces `my_role` to STUDENT for everyone, staff included.
    expect(memberTitle("STUDENT", "super_admin")).toBe("Student");
    expect(memberTitle(undefined, "teacher")).toBeNull();
  });
});
