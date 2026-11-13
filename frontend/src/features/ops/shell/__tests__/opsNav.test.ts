/**
 * The ops console's map (design handoff v0.4, Shell board · Full map): six categories, the groups inside them, every
 * page with the same label, href and role rule it had in the long sidebar; the breadcrumb's three levels.
 */
import { describe, expect, it } from "vitest";

import { ICON_NAMES } from "@/components/ui/Icon";
import { ADMIN_OPS_SECTIONS } from "@/features/ops/adminScope";
import {
  OPS_CATEGORIES,
  OPS_NAV_GROUPS,
  categoryOf,
  crumbsFor,
  firstHref,
  sectionFor,
  sectionLabel,
  visibleCategories,
  visibleNav,
  type ConsoleCategory,
  type OpsNavGroup,
} from "../opsNav";

const SUPER_ADMIN = { role: "super_admin", permissions: ["*"] };
const DJANGO_SUPERUSER = { role: "admin", permissions: ["*"], is_superuser: true };
const ADMIN = { role: "admin", permissions: ["manage_users", "view_dashboard"] };
const TEACHER = { role: "teacher", permissions: ["assign_access"] };

const hrefs = (groups: readonly OpsNavGroup[]) => groups.flatMap((g) => g.items.map((i) => i.href));
const labels = (groups: readonly OpsNavGroup[]) => groups.flatMap((g) => g.items.map((i) => i.label));
const ids = (categories: readonly ConsoleCategory[]) => categories.map((c) => c.id);
const map = (c: ConsoleCategory) => c.groups.map((g) => [g.caption, g.items.map((i) => i.label)]);

describe("OPS_CATEGORIES", () => {
  it("is the board's map: six categories, their groups, every page", () => {
    expect(OPS_CATEGORIES.map((c) => c.label)).toEqual(["Today", "People", "Teaching", "Centre", "Content", "System"]);
    const [today, people, teaching, centre, content, system] = OPS_CATEGORIES;
    expect(map(today)).toEqual([[null, ["Today"]]]);
    expect(map(people)).toEqual([
      ["Learners", ["Students", "Public users"]],
      ["Team", ["Staff", "Access"]],
    ]);
    expect(map(teaching)).toEqual([
      ["Classes", ["Classrooms", "Branches"]],
      ["Course", ["Journals", "Midterm results"]],
      ["Exams", ["Mock sittings", "Exam dates"]],
    ]);
    expect(map(centre)).toEqual([
      ["Enrolment", ["Trials", "lc-up (CRM link)"]],
      ["Money", ["Finance", "Reward shop"]],
      ["Messages", ["SMS"]],
      ["Help", ["Support hours"]],
    ]);
    expect(map(content)).toEqual([
      ["Engage", ["Events", "Surveys"]],
      ["Publish", ["Telegram posts", "Stories"]],
    ]);
    expect(map(system)).toEqual([
      ["App", ["Mobile app"]],
      ["Reach", ["Broadcast"]],
    ]);
  });

  it("keeps every page of the old sidebar — same href, label, icon and role rule — and adds none", () => {
    const pages = OPS_NAV_GROUPS.flatMap((g) => g.items);
    expect(pages.map((p) => p.href).sort()).toEqual(
      [
        "/ops",
        "/ops/students",
        "/ops/public",
        "/ops/staff",
        "/ops/access",
        "/ops/classrooms",
        "/ops/branches",
        "/ops/journals",
        "/ops/midterms",
        "/ops/mock-sessions",
        "/ops/exam-dates",
        "/ops/trials",
        "/ops/finance",
        "/ops/sms",
        "/ops/lcup",
        "/ops/support",
        "/ops/shop",
        "/ops/events",
        "/ops/telegram-posts",
        "/ops/stories",
        "/ops/surveys",
        "/ops/mobile",
        "/ops/broadcast",
      ].sort(),
    );
    expect(pages.filter((p) => p.superAdminOnly).map((p) => p.href).sort()).toEqual(["/ops/broadcast", "/ops/mobile", "/ops/surveys"]);
    expect(pages.find((p) => p.href === "/ops/trials")?.countKey).toBe("trials");
    for (const item of pages) expect(ICON_NAMES).toContain(item.icon);
    for (const c of OPS_CATEGORIES) expect(ICON_NAMES).toContain(c.icon);
  });

  it("gives every category its own G-letter, and Today is the one home", () => {
    expect(OPS_CATEGORIES.map((c) => c.letter)).toEqual(["T", "P", "E", "C", "O", "S"]);
    expect(OPS_CATEGORIES.filter((c) => c.home).map((c) => c.id)).toEqual(["today"]);
  });

  it("carries the tab pages' own tabs, in their own words", () => {
    const tabs = (href: string) => OPS_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === href)?.tabs?.map((t) => t.label);
    expect(tabs("/ops/finance")).toEqual(["Overview", "Debtors", "Payments", "Ledger"]);
    expect(tabs("/ops/sms")).toEqual(["Overview", "Journal", "Campaigns", "Debt warnings", "Templates"]);
    expect(tabs("/ops/lcup")).toEqual(["Status", "Groups", "Students", "Teachers", "Accounts", "Attendance", "Archive"]);
    expect(tabs("/ops/trials")).toEqual(["Trial students", "Not on class list"]);
  });

  it("no longer lists the old single Users page", () => {
    expect(hrefs(OPS_NAV_GROUPS)).not.toContain("/ops/users");
  });
});

describe("visibleNav / visibleCategories", () => {
  it("shows a super admin everything, in order", () => {
    expect(hrefs(visibleNav(OPS_NAV_GROUPS, SUPER_ADMIN))).toEqual(hrefs(OPS_NAV_GROUPS));
    // A Django superuser counts too, whatever the role field says.
    expect(hrefs(visibleNav(OPS_NAV_GROUPS, DJANGO_SUPERUSER))).toEqual(hrefs(OPS_NAV_GROUPS));
    expect(ids(visibleCategories(OPS_CATEGORIES, SUPER_ADMIN))).toEqual(["today", "people", "teaching", "centre", "content", "system"]);
  });

  it("hides the super-admin-only items from everyone else", () => {
    const seen = hrefs(visibleNav(OPS_NAV_GROUPS, TEACHER));
    for (const href of ["/ops/surveys", "/ops/mobile", "/ops/broadcast"]) expect(seen).not.toContain(href);
    // The rest of the console stays: teachers are not scoped.
    for (const href of ["/ops/journals", "/ops/midterms", "/ops/stories", "/ops/exam-dates"]) expect(seen).toContain(href);
  });

  it("drops a category with nothing the person may open — System has only super-admin pages", () => {
    expect(ids(visibleCategories(OPS_CATEGORIES, TEACHER))).toEqual(["today", "people", "teaching", "centre", "content"]);
    // Inside Content, the Engage group keeps Events without Surveys.
    const content = visibleCategories(OPS_CATEGORIES, TEACHER).find((c) => c.id === "content")!;
    expect(map(content)).toEqual([
      ["Engage", ["Events"]],
      ["Publish", ["Telegram posts", "Stories"]],
    ]);
  });

  it("shows a desk admin only the school's sections: five categories, no System", () => {
    const categories = visibleCategories(OPS_CATEGORIES, ADMIN);
    expect(ids(categories)).toEqual(["today", "people", "teaching", "centre", "content"]);
    const seen = categories.flatMap((c) => hrefs(c.groups));
    for (const href of seen) expect(ADMIN_OPS_SECTIONS).toContain(href);
    expect(seen).toEqual([
      "/ops",
      "/ops/students",
      "/ops/public",
      "/ops/staff",
      "/ops/access",
      "/ops/classrooms",
      "/ops/branches",
      "/ops/trials",
      "/ops/lcup",
      "/ops/finance",
      "/ops/shop",
      "/ops/sms",
      "/ops/support",
      "/ops/events",
      "/ops/telegram-posts",
    ]);
    // Teaching keeps only Classes (Course and Exams are not the desk's).
    expect(categories.find((c) => c.id === "teaching")!.groups.map((g) => g.caption)).toEqual(["Classes"]);
    // Content keeps Engage (Events) and Publish (Telegram posts).
    expect(labels(categories.find((c) => c.id === "content")!.groups)).toEqual(["Events", "Telegram posts"]);
  });

  it("shows nothing super-admin-only before `me` has loaded", () => {
    const seen = hrefs(visibleNav(OPS_NAV_GROUPS, undefined));
    expect(seen).not.toContain("/ops/broadcast");
    expect(seen).toContain("/ops");
  });

  it("goes to a category's first page it may open", () => {
    const content = visibleCategories(OPS_CATEGORIES, TEACHER).find((c) => c.id === "content")!;
    expect(firstHref(content)).toBe("/ops/events");
    expect(firstHref(OPS_CATEGORIES[3])).toBe("/ops/trials");
  });
});

describe("categoryOf", () => {
  it("finds a page's category, a record inside it, and a link with a query", () => {
    expect(categoryOf("/ops/finance", OPS_CATEGORIES)?.category.id).toBe("centre");
    expect(categoryOf("/ops/classrooms/12", OPS_CATEGORIES)?.item.label).toBe("Classrooms");
    expect(categoryOf("/ops/classrooms?status=active", OPS_CATEGORIES)?.category.id).toBe("teaching");
    expect(categoryOf("/ops", OPS_CATEGORIES)?.category.id).toBe("today");
  });

  it("has nothing for a page the map does not list", () => {
    expect(categoryOf("/ops/users", OPS_CATEGORIES)).toBeNull();
    expect(categoryOf("/ops/shopping", OPS_CATEGORIES)).toBeNull();
  });
});

describe("crumbsFor", () => {
  const opts = { categories: OPS_CATEGORIES, root: "/ops", rootLabel: "Admin" };
  const words = (c: { label: string }[]) => c.map((x) => x.label);

  it("is category › page › the open tab", () => {
    const crumbs = crumbsFor("/ops/finance", { ...opts, tab: "debtors" });
    expect(words(crumbs)).toEqual(["Centre", "Finance", "Debtors"]);
    expect(crumbs.map((c) => c.href)).toEqual(["/ops/trials", "/ops/finance", undefined]);
  });

  it("names the first tab when none is chosen, and prefers the page's own published tabs", () => {
    expect(words(crumbsFor("/ops/sms", opts))).toEqual(["Centre", "SMS", "Overview"]);
    expect(words(crumbsFor("/ops/finance", { ...opts, tabs: [{ id: "x", label: "Published" }], tab: "x" }))).toEqual(["Centre", "Finance", "Published"]);
  });

  it("is category › page for a page without tabs", () => {
    const crumbs = crumbsFor("/ops/students", opts);
    expect(words(crumbs)).toEqual(["People", "Students"]);
    expect(crumbs[1].href).toBeUndefined();
  });

  it("names the open record when it is known, else stops at its page", () => {
    expect(words(crumbsFor("/ops/classrooms/12", { ...opts, detail: "Middle M5" }))).toEqual(["Teaching", "Classrooms", "Middle M5"]);
    const unknown = crumbsFor("/ops/classrooms/12", opts);
    expect(words(unknown)).toEqual(["Teaching", "Classrooms"]);
  });

  it("is just Today on the dashboard", () => {
    expect(words(crumbsFor("/ops", opts))).toEqual(["Today"]);
  });

  it("keeps Admin › <page> for a page the map does not list", () => {
    expect(crumbsFor("/ops/users", opts)).toEqual([{ label: "Admin", href: "/ops" }, { label: "Users" }]);
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
