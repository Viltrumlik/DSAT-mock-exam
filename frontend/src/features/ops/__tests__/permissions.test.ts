import { describe, expect, it } from "vitest";

import { P, holds, isDeskViewer, isOwner, mayChangeAccount, rolesYouMayGive } from "../permissions";

const OWNER = { role: "super_admin", permissions: ["*"] };
const ROOT_AS_TEACHER = { role: "teacher", permissions: ["*"], is_superuser: true };
const ADMIN = { role: "admin", permissions: ["manage_users", "assign_access", "view_dashboard", "view_money", "take_payment"] };
const TEACHER = { role: "teacher", permissions: ["assign_access", "view_dashboard"] };

describe("holds", () => {
  it("is true when any one of the codenames is held", () => {
    expect(holds(ADMIN, P.voidPayment, P.takePayment)).toBe(true);
    expect(holds(ADMIN, P.voidPayment)).toBe(false);
  });

  it("gives the owner everything through *", () => {
    expect(holds(OWNER, P.sendSms)).toBe(true);
  });

  it("asks nothing when no codename is given", () => {
    expect(holds(TEACHER)).toBe(true);
  });

  it("holds nothing before `me` has loaded, or from a payload without a list", () => {
    expect(holds(undefined, P.viewMoney)).toBe(false);
    expect(holds({ role: "admin" }, P.viewMoney)).toBe(false);
  });
});

describe("isOwner and isDeskViewer", () => {
  it("knows the owner by role, superuser or *", () => {
    expect(isOwner(OWNER)).toBe(true);
    expect(isOwner(ROOT_AS_TEACHER)).toBe(true);
    expect(isOwner(ADMIN)).toBe(false);
  });

  it("makes a desk viewer of whoever holds a CRM permission, never the owner", () => {
    expect(isDeskViewer(ADMIN)).toBe(true);
    expect(isDeskViewer(TEACHER)).toBe(false);
    expect(isDeskViewer(OWNER)).toBe(false);
  });
});

describe("mayChangeAccount", () => {
  it("lets an administrator change learners only: staff are the owner's", () => {
    for (const role of ["student", "public_student"]) {
      expect(mayChangeAccount(ADMIN, role)).toBe(true);
    }
    for (const role of ["teacher", "support_teacher", "accountant", "admin", "test_admin", "super_admin"]) {
      expect(mayChangeAccount(ADMIN, role)).toBe(false);
    }
  });

  it("lets whoever holds manage_staff change staff ranked below them", () => {
    const withStaff = { ...ADMIN, permissions: [...ADMIN.permissions, "manage_staff"] };
    expect(mayChangeAccount(withStaff, "teacher")).toBe(true);
    expect(mayChangeAccount(withStaff, "admin")).toBe(false);
  });

  it("lets the owner change any account", () => {
    expect(mayChangeAccount(OWNER, "super_admin")).toBe(true);
    expect(mayChangeAccount(ROOT_AS_TEACHER, "admin")).toBe(true);
  });

  it("needs user management", () => {
    expect(mayChangeAccount(TEACHER, "student")).toBe(false);
  });
});

describe("rolesYouMayGive", () => {
  it("offers an administrator only the learner roles: a staff role is the owner's to give", () => {
    expect(rolesYouMayGive(ADMIN)).toEqual(["student", "public_student"]);
  });

  it("offers the owner every role, the accountant included", () => {
    expect(rolesYouMayGive(OWNER)).toContain("super_admin");
    expect(rolesYouMayGive(OWNER)).toContain("accountant");
  });
});
