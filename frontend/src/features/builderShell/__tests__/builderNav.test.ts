/**
 * The builder in the ops console's frame (owner 2026-10-15): the same items, names and order its
 * own sidebar had; one current item (the longest match); the breadcrumb under "Builder"; and the
 * editors still full-screen.
 */
import { describe, expect, it } from "vitest";

import { activeNavItem, sectionFor, visibleByRole } from "@/features/ops/shell/opsNav";
import { qbChangeListQuery, QB_FILTER_KEYS } from "@/domains/questionBank/changelist";
import { readChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import { BUILDER_CONSOLE, BUILDER_NAV_GROUPS, isBuilderEditorRoute } from "../builderNav";

const labels = (i: number) => BUILDER_NAV_GROUPS[i].items.map((item) => item.label);
const active = (path: string) => activeNavItem(path, BUILDER_NAV_GROUPS)?.label ?? null;
const section = (path: string) => sectionFor(path, BUILDER_CONSOLE.groups, BUILDER_CONSOLE.root);

describe("BUILDER_NAV_GROUPS", () => {
  it("keeps the builder's own items, names and order", () => {
    expect(BUILDER_NAV_GROUPS.map((g) => g.caption)).toEqual([null, "Learning", "Simulation", null]);
    expect(labels(0)).toEqual(["Dashboard"]);
    expect(labels(1)).toEqual([
      "Question Bank",
      "Triage Queue",
      "Imports",
      "Sets bank (legacy)",
      "Assessments",
      "Midterms",
      "Vocabulary",
      "Categories",
    ]);
    expect(labels(2)).toEqual(["Past papers", "Practice tests", "Full mocks"]);
    expect(labels(3)).toEqual(["Archived"]);
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
    expect(active("/builder/question-bank")).toBe("Question Bank");
    expect(active("/builder/question-bank/triage")).toBe("Triage Queue");
    expect(active("/builder/question-bank/imports/7")).toBe("Imports");
    // A question's own pages belong to the Question Bank (they lit nothing before).
    expect(active("/builder/question-bank/42")).toBe("Question Bank");
    expect(active("/builder/question-bank/new")).toBe("Question Bank");
  });

  it("matches the dashboard exactly and nothing for a look-alike", () => {
    expect(active("/builder")).toBe("Dashboard");
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
      "/builder/pastpapers/1/2/3",
      "/builder/practice-tests/1/2/3",
      "/builder/midterms/1/2/3",
      "/builder/full-mocks/4/5",
    ]) {
      expect(isBuilderEditorRoute(path)).toBe(true);
    }
    for (const path of ["/builder", "/builder/sets", "/builder/sets/new", "/builder/pastpapers", "/builder/full-mocks/4"]) {
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
