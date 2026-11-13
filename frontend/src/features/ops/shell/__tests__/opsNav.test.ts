import { describe, expect, it } from "vitest";

import { ICON_NAMES } from "@/components/ui/Icon";
import { OPS_NAV_GROUPS, opsPathAllowed, sectionFor, sectionLabel, visibleNav, type OpsNavGroup } from "../opsNav";

const SUPER_ADMIN = { role: "super_admin", permissions: ["*"] };
const DJANGO_SUPERUSER = { role: "admin", permissions: ["*"], is_superuser: true };
/** What GET /users/me/ gives an administrator: the old six, plus every CRM permission (PR 2). */
const ADMIN = {
  role: "admin",
  permissions: ["adjust_balance", "assign_access", "create_classroom", "debt_freeze", "edit_people", "enroll", "events_shop", "lcup_tools", "manage_groups", "manage_seats", "manage_staff", "manage_tests", "manage_users", "send_debt_sms", "send_sms", "set_prices", "submit_test", "take_payment", "view_dashboard", "view_money", "view_people", "view_reports", "void_payment"],
};
/** An accountant as PR 4 will make one: money only. */
const ACCOUNTANT = {
  role: "accountant",
  permissions: ["view_people", "view_money", "take_payment", "void_payment", "adjust_balance", "set_prices", "debt_freeze", "view_reports", "send_debt_sms"],
};
const TEACHER = { role: "teacher", permissions: ["assign_access"] };

const hrefs = (groups: OpsNavGroup[]) => groups.flatMap((g) => g.items.map((i) => i.href));
const captions = (groups: OpsNavGroup[]) => groups.map((g) => g.caption);

describe("OPS_NAV_GROUPS", () => {
  it("is grouped as before, with the redesign's clearer names and the Centre in desk order", () => {
    expect(captions([...OPS_NAV_GROUPS])).toEqual([null, "People", "Teaching", "Centre", "Content", "System"]);
    expect(OPS_NAV_GROUPS[0].items.map((i) => i.label)).toEqual(["Today"]);
    expect(OPS_NAV_GROUPS[1].items.map((i) => i.label)).toEqual(["Students", "Public users", "Staff", "Access"]);
    expect(OPS_NAV_GROUPS[2].items.map((i) => i.label)).toEqual([
      "Classrooms",
      "Branches",
      "Journals",
      "Midterm results",
      "Mock sittings",
      "Exam dates",
    ]);
    expect(OPS_NAV_GROUPS[3].items.map((i) => i.label)).toEqual([
      "Trials",
      "Finance",
      "SMS",
      "lc-up (CRM link)",
      "Support hours",
      "Reward shop",
    ]);
    expect(OPS_NAV_GROUPS[4].items.map((i) => i.label)).toEqual(["Events", "Telegram posts", "Stories", "Surveys"]);
    expect(OPS_NAV_GROUPS[5].items.map((i) => i.label)).toEqual(["Mobile app", "Broadcast"]);
  });

  it("draws every item with an icon from the design's set", () => {
    for (const item of OPS_NAV_GROUPS.flatMap((g) => g.items)) expect(ICON_NAMES).toContain(item.icon);
  });

  it("no longer lists the old single Users page", () => {
    expect(hrefs([...OPS_NAV_GROUPS])).not.toContain("/ops/users");
  });
});

describe("visibleNav", () => {
  it("shows a super admin everything, in order", () => {
    const groups = visibleNav(OPS_NAV_GROUPS, SUPER_ADMIN);
    expect(captions(groups)).toEqual([null, "People", "Teaching", "Centre", "Content", "System"]);
    expect(hrefs(groups)).toEqual(hrefs([...OPS_NAV_GROUPS]));
    // A Django superuser counts too, whatever the role field says.
    expect(hrefs(visibleNav(OPS_NAV_GROUPS, DJANGO_SUPERUSER))).toEqual(hrefs([...OPS_NAV_GROUPS]));
  });

  it("hides the super-admin-only items from everyone else", () => {
    const seen = hrefs(visibleNav(OPS_NAV_GROUPS, TEACHER));
    for (const href of ["/ops/surveys", "/ops/mobile", "/ops/broadcast"]) expect(seen).not.toContain(href);
    // Teachers are not the desk: the academic pages stay for them.
    for (const href of ["/ops/journals", "/ops/midterms", "/ops/exam-dates", "/ops/students"]) {
      expect(seen).toContain(href);
    }
  });

  it("shows a section only to someone holding a permission its API checks", () => {
    const seen = hrefs(visibleNav(OPS_NAV_GROUPS, TEACHER));
    for (const href of [
      "/ops/classrooms",
      "/ops/trials",
      "/ops/finance",
      "/ops/sms",
      "/ops/lcup",
      "/ops/shop",
      "/ops/events",
      "/ops/telegram-posts",
      "/ops/stories",
    ]) {
      expect(seen).not.toContain(href);
    }
  });

  it("drops a group whose items are all filtered out", () => {
    // System has only super-admin items; Content only events_shop and super-admin ones.
    expect(captions(visibleNav(OPS_NAV_GROUPS, TEACHER))).toEqual([null, "People", "Teaching", "Centre"]);
  });

  it("shows an administrator exactly the school's sections, as before permissions", () => {
    const groups = visibleNav(OPS_NAV_GROUPS, ADMIN);
    const seen = hrefs(groups);
    expect(seen).toEqual([
      "/ops",
      "/ops/students",
      "/ops/public",
      "/ops/staff",
      "/ops/access",
      "/ops/classrooms",
      "/ops/branches",
      "/ops/trials",
      "/ops/finance",
      "/ops/sms",
      "/ops/lcup",
      "/ops/support",
      "/ops/shop",
      "/ops/events",
      "/ops/telegram-posts",
    ]);
    // Content keeps Events and Telegram posts; System is gone.
    expect(captions(groups)).toEqual([null, "People", "Teaching", "Centre", "Content"]);
  });

  it("hides a group that is empty for the viewer, using a custom group list", () => {
    const custom: OpsNavGroup[] = [
      { id: "a", caption: "A", items: [OPS_NAV_GROUPS[0].items[0]] },
      { id: "b", caption: "B", items: OPS_NAV_GROUPS[5].items },
    ];
    expect(captions(visibleNav(custom, ADMIN))).toEqual(["A"]);
    expect(captions(visibleNav(custom, SUPER_ADMIN))).toEqual(["A", "B"]);
  });

  it("shows an accountant the money, and none of the desk's other sections", () => {
    // Branches and Support hours still go by role on the server; the accountant's role decides them (PR 4).
    const seen = hrefs(visibleNav(OPS_NAV_GROUPS, ACCOUNTANT));
    for (const href of ["/ops", "/ops/finance", "/ops/sms", "/ops/classrooms"]) expect(seen).toContain(href);
    for (const href of [
      "/ops/students",
      "/ops/staff",
      "/ops/trials",
      "/ops/lcup",
      "/ops/shop",
      "/ops/events",
      "/ops/journals",
      "/ops/stories",
    ]) {
      expect(seen).not.toContain(href);
    }
  });

  it("follows a per-person tick: an administrator without events_shop loses the three content desks", () => {
    const noShop = { ...ADMIN, permissions: ADMIN.permissions.filter((p) => p !== "events_shop") };
    const seen = hrefs(visibleNav(OPS_NAV_GROUPS, noShop));
    for (const href of ["/ops/shop", "/ops/events", "/ops/telegram-posts"]) expect(seen).not.toContain(href);
    expect(seen).toContain("/ops/finance");
  });

  it("shows nothing super-admin-only before `me` has loaded", () => {
    const seen = hrefs(visibleNav(OPS_NAV_GROUPS, undefined));
    expect(seen).not.toContain("/ops/broadcast");
    expect(seen).toContain("/ops");
  });
});

describe("sectionLabel", () => {
  it("names a section after its nav item", () => {
    expect(sectionLabel("/ops")).toBe("Today");
    expect(sectionLabel("/ops/students")).toBe("Students");
    expect(sectionLabel("/ops/public")).toBe("Public users");
    expect(sectionLabel("/ops/finance")).toBe("Finance");
    expect(sectionLabel("/ops/sms")).toBe("SMS");
    expect(sectionLabel("/ops/sms/campaigns/7")).toBe("SMS");
    expect(sectionLabel("/ops/mock-sessions")).toBe("Mock sittings");
  });

  it("resolves a deeper path to its section", () => {
    expect(sectionLabel("/ops/classrooms/12")).toBe("Classrooms");
    expect(sectionLabel("/ops/journals/3/lessons/9")).toBe("Journals");
    expect(sectionLabel("/ops/students/42/edit")).toBe("Students");
    expect(sectionFor("/ops/classrooms/12")).toEqual({ href: "/ops/classrooms", label: "Classrooms" });
  });

  it("does not let a look-alike prefix match", () => {
    expect(sectionLabel("/ops/shopping")).toBe("Shopping");
    expect(sectionFor("/ops/shopping")?.href).toBe("/ops/shopping");
  });

  it("names an ops page the nav does not list after its path", () => {
    expect(sectionLabel("/ops/users")).toBe("Users");
    expect(sectionLabel("/ops/users/5")).toBe("Users");
    expect(sectionFor("/ops/users/5")).toEqual({ href: "/ops/users", label: "Users" });
  });

  it("has nothing to say outside the console", () => {
    expect(sectionLabel("/login")).toBeNull();
    expect(sectionLabel("/")).toBeNull();
  });
});

describe("opsPathAllowed", () => {
  it("opens to an administrator the school's sections, nested pages included", () => {
    for (const path of [
      "/ops",
      "/ops/classrooms/12",
      "/ops/students/42",
      "/ops/users",
      "/ops/users/5/edit",
      "/ops/sms/campaigns/7",
      "/ops/finance",
      "/ops/trials",
      "/ops/telegram-posts",
    ]) {
      expect(opsPathAllowed(path, ADMIN)).toBe(true);
    }
  });

  it("keeps the rest from an administrator, however it is reached", () => {
    for (const path of [
      "/ops/journals",
      "/ops/journals/3/lessons/9",
      "/ops/midterms",
      "/ops/mock-sessions",
      "/ops/surveys",
      "/ops/stories",
      "/ops/exam-dates",
      "/ops/assignments",
      "/ops/broadcast",
    ]) {
      expect(opsPathAllowed(path, ADMIN)).toBe(false);
    }
  });

  it("does not let a look-alike prefix through", () => {
    expect(opsPathAllowed("/ops/usersettings", ADMIN)).toBe(false);
    expect(opsPathAllowed("/ops/shopping", ADMIN)).toBe(false);
    expect(opsPathAllowed("/ops/smsx", ADMIN)).toBe(false);
  });

  it("opens everything to the owner", () => {
    for (const path of ["/ops/journals", "/ops/stories", "/ops/broadcast", "/ops/assignments", "/ops/finance"]) {
      expect(opsPathAllowed(path, SUPER_ADMIN)).toBe(true);
    }
  });

  it("closes to a teacher the pages the server refuses them, and leaves theirs open", () => {
    for (const path of ["/ops/finance", "/ops/sms", "/ops/lcup", "/ops/classrooms/3", "/ops/events"]) {
      expect(opsPathAllowed(path, TEACHER)).toBe(false);
    }
    for (const path of ["/ops", "/ops/students", "/ops/journals", "/ops/users", "/ops/assignments"]) {
      expect(opsPathAllowed(path, TEACHER)).toBe(true);
    }
  });
});
