/**
 * The builder in the ops console's frame (owner 2026-10-15): the same items, names and order its
 * own sidebar had; one current item (the longest match); the breadcrumb under "Builder"; and the
 * editors still full-screen.
 */
import { describe, expect, it } from "vitest";

import { activeNavItem, sectionFor, visibleByRole } from "@/features/ops/shell/opsNav";
import { qbChangeListQuery, QB_FILTER_KEYS } from "@/domains/questionBank/changelist";
import { readChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import { ICON_NAMES } from "@/components/ui/Icon";
import { BUILDER_CATEGORIES, BUILDER_CONSOLE, BUILDER_NAV_GROUPS, isBuilderEditorRoute } from "../builderNav";

const active = (path: string) => activeNavItem(path, BUILDER_NAV_GROUPS)?.label ?? null;
const section = (path: string) => sectionFor(path, BUILDER_CONSOLE.groups, BUILDER_CONSOLE.root);

describe("BUILDER_CATEGORIES", () => {
  it("is the board's map: Home, Learning, Simulation, Archive — the same pages, names and hrefs", () => {
    expect(BUILDER_CATEGORIES.map((c) => [c.label, c.letter])).toEqual([
      ["Home", "H"],
      ["Learning", "L"],
      ["Simulation", "S"],
      ["Archive", "A"],
    ]);
    expect(BUILDER_CATEGORIES.map((c) => c.groups.map((g) => [g.caption, g.items.map((i) => i.label)]))).toEqual([
      [[null, ["Studio home"]]],
      [
        ["Questions", ["Question bank"]],
        ["Sets", ["Assessments", "Midterms", "Categories"]],
        ["Words", ["Vocabulary"]],
      ],
      [
        ["Real papers", ["Past papers"]],
        ["Practice", ["Practice tests"]],
        ["Timed exams", ["Full mocks"]],
      ],
      [
        ["Retired", ["Archived"]],
        ["Legacy", ["Old sets bank"]],
      ],
    ]);
    expect(BUILDER_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)).sort()).toEqual(
      [
        "/builder",
        "/builder/question-bank",
        "/builder/sets",
        "/builder/midterms",
        "/builder/vocabulary",
        "/builder/categories",
        "/builder/pastpapers",
        "/builder/practice-tests",
        "/builder/full-mocks",
        "/builder/bank",
        "/builder/archived",
      ].sort(),
    );
    // The Review queue and Imports stay removed (owner, 2026-11-12).
    expect(BUILDER_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label))).not.toContain("Review queue");
  });

  it("draws every item with an icon from the design's set", () => {
    for (const item of BUILDER_NAV_GROUPS.flatMap((g) => g.items)) expect(ICON_NAMES).toContain(item.icon);
  });

  it("shows every item — the builder has no admin scoping", () => {
    const all = BUILDER_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    for (const me of [undefined, { role: "admin", permissions: [] }, { role: "super_admin" }]) {
      expect(visibleByRole(BUILDER_NAV_GROUPS, me).flatMap((g) => g.items.map((i) => i.href))).toEqual(all);
    }
  });
});

describe("the current item", () => {
  it("is the longest match, so a nested item does not light its parent too", () => {
    expect(active("/builder/question-bank")).toBe("Question bank");
    // A question's own pages belong to the Question Bank (they lit nothing before).
    expect(active("/builder/question-bank/42")).toBe("Question bank");
    expect(active("/builder/question-bank/new")).toBe("Question bank");
  });

  it("matches the dashboard exactly and nothing for a look-alike", () => {
    expect(active("/builder")).toBe("Studio home");
    expect(active("/builder/settings")).toBeNull();
    expect(active("/builder/setsx")).toBeNull();
  });

  it("names the breadcrumb's section", () => {
    expect(section("/builder/sets/new")).toEqual({ href: "/builder/sets", label: "Assessments" });
    expect(section("/builder/vocabulary/3/9")).toEqual({ href: "/builder/vocabulary", label: "Vocabulary" });
    expect(section("/builder/unlisted-page")).toEqual({ href: "/builder/unlisted-page", label: "Unlisted page" });
    expect(section("/ops/students")).toBeNull();
  });
});

describe("isBuilderEditorRoute", () => {
  it("keeps the editors full-screen and the lists in the frame", () => {
    for (const path of [
      "/builder/sets/12",
      // A past paper / practice test module: the test, then the module (two numbers).
      "/builder/pastpapers/2/12",
      "/builder/practice-tests/21/50",
      "/builder/midterms/1/2/3",
      "/builder/full-mocks/4/5",
    ]) {
      expect(isBuilderEditorRoute(path)).toBe(true);
    }
    for (const path of [
      "/builder",
      "/builder/sets",
      "/builder/sets/new",
      "/builder/pastpapers",
      "/builder/practice-tests",
      "/builder/midterms",
      "/builder/full-mocks/4",
    ]) {
      expect(isBuilderEditorRoute(path)).toBe(false);
    }
  });
});

describe("qbChangeListQuery", () => {
  it("sends only the known filters, and the defaults stay out", () => {
    const params = readChangeListParams(new URLSearchParams("status=TRIAGE&subject=MATH&teacher=4&q=linear"), QB_FILTER_KEYS);
    expect(qbChangeListQuery(params)).toEqual({ status: "TRIAGE", subject: "MATH", q: "linear", page_size: 50 });
  });

  it("carries the ordering, the page and the page size", () => {
    const params = readChangeListParams(new URLSearchParams("o=-qb_id&p=3&ps=100&classified=no"), QB_FILTER_KEYS);
    expect(qbChangeListQuery(params)).toEqual({ classified: "no", o: "-qb_id", page: 3, page_size: 100 });
  });
});
