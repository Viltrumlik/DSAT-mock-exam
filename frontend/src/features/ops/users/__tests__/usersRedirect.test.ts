import { describe, expect, it } from "vitest";
import { usersRedirectTarget } from "../usersRedirect";

describe("usersRedirectTarget — where an old /ops/users link lands", () => {
  it("sends the learner kinds to Students or Public users", () => {
    expect(usersRedirectTarget("?kind=centre")).toBe("/ops/students");
    expect(usersRedirectTarget("?kind=frozen_debt")).toBe("/ops/students?status=frozen_debt");
    expect(usersRedirectTarget("?kind=frozen_admin")).toBe("/ops/students?status=frozen_admin");
    expect(usersRedirectTarget("?kind=public")).toBe("/ops/public");
  });

  it("sends a staff role to Staff with that role, and the learner roles to their lists", () => {
    expect(usersRedirectTarget("?role=teacher")).toBe("/ops/staff?role=teacher");
    expect(usersRedirectTarget("?role=support_teacher")).toBe("/ops/staff?role=support_teacher");
    expect(usersRedirectTarget("?role=public_student")).toBe("/ops/public");
    expect(usersRedirectTarget("?role=student")).toBe("/ops/students");
  });

  it("falls back to Students for anything else", () => {
    expect(usersRedirectTarget("")).toBe("/ops/students");
    expect(usersRedirectTarget("?role=wizard")).toBe("/ops/students");
    expect(usersRedirectTarget("?kind=all")).toBe("/ops/students");
  });
});
