import { describe, expect, it } from "vitest";

import { ADMIN_OPS_SECTIONS, isAdminOpsPath, isScopedOpsAdmin } from "../adminScope";

describe("isScopedOpsAdmin", () => {
  it("applies to an admin", () => {
    expect(isScopedOpsAdmin({ role: "admin", permissions: ["manage_users", "view_dashboard"] })).toBe(true);
    expect(isScopedOpsAdmin({ role: " Admin ", permissions: [] })).toBe(true);
  });

  it("leaves a super admin, a wildcard admin and every other role alone", () => {
    expect(isScopedOpsAdmin({ role: "super_admin", permissions: ["*"] })).toBe(false);
    // A Django superuser whose role field reads "admin": the wildcard wins.
    expect(isScopedOpsAdmin({ role: "admin", permissions: ["*"] })).toBe(false);
    expect(isScopedOpsAdmin({ role: "teacher", permissions: ["assign_access"] })).toBe(false);
    expect(isScopedOpsAdmin({ role: "test_auditor", permissions: ["manage_tests"] })).toBe(false);
    expect(isScopedOpsAdmin(undefined)).toBe(false);
  });
});

describe("isAdminOpsPath", () => {
  it("lets the school's seven sections through, nested pages included", () => {
    for (const href of ADMIN_OPS_SECTIONS) expect(isAdminOpsPath(href)).toBe(true);
    expect(isAdminOpsPath("/ops/classrooms/12")).toBe(true);
    expect(isAdminOpsPath("/ops/users/5/edit")).toBe(true);
  });

  it("keeps every other section out, however it is reached", () => {
    for (const path of [
      "/ops/journals",
      "/ops/journals/3/lessons/9",
      "/ops/midterms",
      "/ops/mock-sessions",
      "/ops/surveys",
      "/ops/stories",
      "/ops/exam-dates",
      "/ops/assignments",
    ]) {
      expect(isAdminOpsPath(path)).toBe(false);
    }
  });

  it("does not let a look-alike prefix through", () => {
    expect(isAdminOpsPath("/ops/usersettings")).toBe(false);
    expect(isAdminOpsPath("/ops/shopping")).toBe(false);
  });
});
