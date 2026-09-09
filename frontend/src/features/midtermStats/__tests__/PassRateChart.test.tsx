/**
 * The one chart on the page, and the four things it must never do.
 *
 * A chart is a claim about comparability, which is what makes it more dangerous than the
 * table beside it: a bar has no room for a "Data gap" marker, no counts under it and no
 * tooltip a printed page can carry. So the rules are enforced before anything is drawn — the
 * gap bucket is not a group, two bars are not a comparison, a bare number on an axis is not a
 * percentage, and the bars are the rows the reader is actually looking at.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { PassRateChart } from "../PassRateChart";
import type { GroupTally, TreeLevel, TreeNode } from "../types";

const tally = (over: Partial<GroupTally> = {}): GroupTally => ({
  roster: 10,
  attended: 9,
  passed_first: 8,
  passed_retake: 1,
  failed: 1,
  absent: 0,
  pending: 0,
  retake_taken: 1,
  retake_passed: 1,
  retake_failed: 0,
  passed: 9,
  pass_rate: 90,
  attendance_rate: 90,
  first_try_share: 88.9,
  retake_share: 11.1,
  classrooms: 2,
  distinct_students: 10,
  ...over,
});

const node = (
  level: TreeLevel,
  id: number | null,
  name: string,
  pass_rate: number | null,
): TreeNode => ({
  ...tally({ pass_rate }),
  key: `${level}:${id ?? "none"}`,
  level,
  id,
  name,
  children: [],
  child_level: null,
});

const branch = (id: number | null, name: string, rate: number | null) =>
  node("branch", id, name, rate);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(el: React.ReactElement): string {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container as HTMLDivElement);
    root.render(el);
  });
  return (container as HTMLDivElement).textContent ?? "";
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const chart = (nodes: TreeNode[], level: TreeLevel = "branch", scope: string | null = null) => (
  <PassRateChart nodes={nodes} level={level} month="2026-09" scope={scope} />
);

describe("PassRateChart", () => {
  it("draws nothing when there are only two groups to compare", () => {
    const out = render(chart([branch(1, "Chilonzor", 91), branch(2, "Yunusobod", 84)]));
    // Two bars beside a two-row table are the same fact drawn twice.
    expect(out).toBe("");
  });

  it("does not let one real branch plus the data gap pass as a two-bar comparison", () => {
    const out = render(chart([branch(1, "Chilonzor", 91), branch(null, "Unassigned", 62)]));
    expect(out).toBe("");
  });

  it("plots the real branches and leaves the data gap out of the bars", () => {
    const out = render(
      chart([
        branch(1, "Chilonzor", 91),
        branch(2, "Yunusobod", 84),
        branch(null, "Unassigned", 62),
        branch(3, "Sergeli", 77),
      ]),
    );
    expect(out).toContain("Pass rate by branch");
    expect(out).toContain("Chilonzor");
    expect(out).toContain("Sergeli");
    // The bucket is named in the caption and never given a bar of its own.
    expect(out).toContain("unassigned bucket is left out");
    const bars = container?.querySelectorAll("ol > li") ?? [];
    expect(bars).toHaveLength(3);
    expect([...bars].some((li) => li.textContent?.includes("Unassigned"))).toBe(false);
  });

  it("puts a unit on every number, axis included", () => {
    const out = render(
      chart([branch(1, "A", 91), branch(2, "B", 84), branch(3, "C", 77)]),
    );
    expect(out).toContain("91%");
    // The axis: bare 0/25/50/75/100 on a page whose other numbers are scores out of 800.
    for (const tick of ["0%", "25%", "50%", "75%", "100%"]) {
      expect(out).toContain(tick);
    }
  });

  it("says which groups have no roster rather than plotting them at zero", () => {
    const out = render(
      chart([
        branch(1, "A", 91),
        branch(2, "B", 84),
        branch(3, "C", 77),
        branch(4, "D", null),
      ]),
    );
    expect(out).toContain("1 branch has no roster this month");
    const bars = container?.querySelectorAll("ol > li") ?? [];
    expect([...bars].some((li) => li.textContent?.includes("D"))).toBe(false);
  });

  /**
   * The rule the drill-down added. The chart used to choose its own subject — branches when
   * there were enough, otherwise teachers — which is indefensible above a table of one
   * department's teachers: the bars would be read as the rows under them.
   */
  it("plots the level the reader is on, and names the node they are inside", () => {
    const out = render(
      chart(
        [
          node("teacher", 1, "Aziza K", 73),
          node("teacher", 2, "Nodira Y", 72),
          node("teacher", 3, "Dilshod R", 65),
        ],
        "teacher",
        "English",
      ),
    );
    expect(out).toContain("Pass rate by teacher · English");
    expect(out).toContain("for English only");
    expect(out).not.toContain("Pass rate by branch");
  });

  it("never treats a department as a data gap, though it has no record id", () => {
    // `id: null` means "Unassigned" for a branch or a teacher and means nothing at all for a
    // department — subject is not a record. Reading the two the same way used to drop English
    // and Math out of their own chart.
    const out = render(
      chart(
        [
          node("department", null, "English", 81),
          node("department", null, "Math", 74),
          node("department", null, "Physics", 69),
        ],
        "department",
      ),
    );
    const bars = container?.querySelectorAll("ol > li") ?? [];
    expect(bars).toHaveLength(3);
    expect(out).not.toContain("unassigned bucket is left out");
  });
});
