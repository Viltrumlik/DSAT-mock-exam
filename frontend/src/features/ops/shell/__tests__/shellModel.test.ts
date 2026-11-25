/**
 * The shell's numbers and the phone's tabs (lc-up structure canvas, 22 Nov 2026): "Needs you" counts only the items
 * that are there to act on; the phone keeps the four daily places as tabs and everything else under More.
 */
import { describe, expect, it } from "vitest";

import { OPS_CATEGORIES, visibleCategories } from "../opsNav";
import { phoneTabs } from "../PhoneNav";
import { attentionItems } from "../shellModel";

describe("attentionItems", () => {
  it("keeps the items of finished sources only — loading and failed ones say so in the bell, not here", () => {
    const item = { id: "a", tone: "attention" as const, title: "3 demo students", action: { label: "Open", href: "/ops/trials" } };
    const sources = [
      { id: "x", status: "done" as const, item },
      { id: "y", status: "done" as const, item: null },
      { id: "z", status: "loading" as const, item: null },
      { id: "w", status: "error" as const, item: null },
    ];
    expect(attentionItems(sources as never)).toEqual([item]);
  });
});

describe("phoneTabs", () => {
  it("makes the four daily places tabs, everything else More's", () => {
    const { shown, more } = phoneTabs(visibleCategories(OPS_CATEGORIES, { role: "super_admin", permissions: ["*"] }));
    expect(shown.map((i) => i.label)).toEqual(["Today", "Students", "Groups", "Finance"]);
    expect(more.map((c) => c.label)).toEqual(["Daily work", "Teaching", "Centre", "Content", "People & system"]);
    // Archive is in More; Timetable is never listed.
    const moreHrefs = more.flatMap((c) => c.groups.flatMap((g) => g.items.map((i) => i.href)));
    expect(moreHrefs).toContain("/ops/archive");
    expect(moreHrefs).not.toContain("/ops/timetable");
    expect(moreHrefs).not.toContain("/ops/students");
  });

  it("gives a console with no daily places its first four pages", () => {
    const tiny = [{ id: "a", label: "A", icon: "home" as const, letter: "A", groups: [{ id: "g", caption: null, items: [1, 2, 3, 4, 5, 6].map((n) => ({ href: `/x/${n}`, label: `P${n}`, icon: "home" as const })) }] }];
    const { shown, more } = phoneTabs(tiny);
    expect(shown.map((i) => i.label)).toEqual(["P1", "P2", "P3", "P4"]);
    expect(more[0].groups[0].items.map((i) => i.label)).toEqual(["P5", "P6"]);
  });
});
