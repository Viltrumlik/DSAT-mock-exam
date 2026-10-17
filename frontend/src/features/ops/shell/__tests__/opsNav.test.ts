import { describe, expect, it } from "vitest";

import { ADMIN_OPS_SECTIONS } from "@/features/ops/adminScope";
import { OPS_NAV_GROUPS, sectionFor, sectionLabel, visibleNav, type OpsNavGroup } from "../opsNav";

const SUPER_ADMIN = { role: "super_admin", permissions: ["*"] };
const DJANGO_SUPERUSER = { role: "admin", permissions: ["*"], is_superuser: true };
const ADMIN = { role: "admin", permissions: ["manage_users", "view_dashboard"] };
const TEACHER = { role: "teacher", permissions: ["assign_access"] };

const hrefs = (groups: OpsNavGroup[]) => groups.flatMap((g) => g.items.map((i) => i.href));
const captions = (groups: OpsNavGroup[]) => groups.map((g) => g.caption);

describe("OPS_NAV_GROUPS", () => {
  it("is grouped Django-admin style, in order", () => {
    expect(captions([...OPS_NAV_GROUPS])).toEqual([null, "People", "Teaching", "Centre", "Content", "System"]);
    expect(OPS_NAV_GROUPS[0].items.map((i) => i.label)).toEqual(["Dashboard"]);
    expect(OPS_NAV_GROUPS[1].items.map((i) => i.label)).toEqual(["Students", "Public users", "Staff", "Access"]);
    expect(OPS_NAV_GROUPS[2].items.map((i) => i.label)).toEqual([
      "Classrooms",
      "Branches",
      "Journals",
      "Midterms",
      "Mock sittings",
      "Exam dates",
    ]);
    expect(OPS_NAV_GROUPS[3].items.map((i) => i.label)).toEqual(["lc-up", "Finance", "Support", "Shop"]);
    expect(OPS_NAV_GROUPS[4].items.map((i) => i.label)).toEqual(["Events", "Telegram posts", "Stories", "Surveys"]);
    expect(OPS_NAV_GROUPS[5].items.map((i) => i.label)).toEqual(["Mobile app", "Broadcast"]);
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
    const groups = visibleNav(OPS_NAV_GROUPS, TEACHER);
    const seen = hrefs(groups);
    for (const href of ["/ops/surveys", "/ops/mobile", "/ops/broadcast"]) expect(seen).not.toContain(href);
    // The rest of the console stays: teachers are not scoped.
    for (const href of ["/ops/journals", "/ops/midterms", "/ops/stories", "/ops/exam-dates"]) {
      expect(seen).toContain(href);
    }
  });

  it("drops a group whose items are all filtered out — System has only super-admin items", () => {
    expect(captions(visibleNav(OPS_NAV_GROUPS, TEACHER))).toEqual([null, "People", "Teaching", "Centre", "Content"]);
  });

  it("shows a scoped admin only the school's sections", () => {
    const groups = visibleNav(OPS_NAV_GROUPS, ADMIN);
    const seen = hrefs(groups);
    for (const href of seen) expect(ADMIN_OPS_SECTIONS).toContain(href);
    expect(seen).toEqual([
      "/ops",
      "/ops/students",
      "/ops/public",
      "/ops/staff",
      "/ops/access",
      "/ops/classrooms",
      "/ops/branches",
      "/ops/lcup",
      "/ops/finance",
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

  it("shows nothing super-admin-only before `me` has loaded", () => {
    const seen = hrefs(visibleNav(OPS_NAV_GROUPS, undefined));
    expect(seen).not.toContain("/ops/broadcast");
    expect(seen).toContain("/ops");
  });
});

describe("sectionLabel", () => {
  it("names a section after its nav item", () => {
    expect(sectionLabel("/ops")).toBe("Dashboard");
    expect(sectionLabel("/ops/students")).toBe("Students");
    expect(sectionLabel("/ops/public")).toBe("Public users");
    expect(sectionLabel("/ops/finance")).toBe("Finance");
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
