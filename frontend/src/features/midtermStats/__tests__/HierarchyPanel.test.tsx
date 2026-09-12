/**
 * The drill-down as a reader meets it: one table, a trail back, and no way to mistake a
 * department's numbers for the school's.
 *
 * The failure this replaced was not a crash — it was four correct tables printed at once,
 * with nothing on screen saying that the teacher in the third was inside the branch in the
 * first. So the assertions here are mostly about what is NOT on screen: one level at a time,
 * and the level you are on, named.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HierarchyPanel } from "../HierarchyPanel";
import { collapseFrom } from "../tree";
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
  classrooms: 1,
  distinct_students: 10,
  ...over,
});

const node = (
  key: string,
  level: TreeLevel,
  name: string,
  kids: TreeNode[] = [],
  over: Partial<TreeNode> = {},
): TreeNode => ({
  ...tally(),
  key,
  level,
  id: 1,
  name,
  children: kids,
  child_level: kids[0]?.level ?? null,
  ...over,
});

const roots = () => [
  node("region:1", "region", "Fergana", [
    node(
      "branch:1",
      "branch",
      "Fergana city",
      [
        node(
          "department:ENGLISH",
          "department",
          "English",
          [
            node("teacher:5", "teacher", "Nodira Yusupova", [
              node("classroom:11", "classroom", "Fergana 12-A", [], {
                id: 11,
                midterms: 2,
                level_label: "Advanced",
                subject_label: "English",
              }),
            ]),
          ],
          { id: null, ...tally({ roster: 40, passed: 28, pass_rate: 70, distinct_students: 34 }) },
        ),
        node("department:MATH", "department", "Math", [], { id: null }),
      ],
      tally({ roster: 60, passed: 45, pass_rate: 75, distinct_students: 52, classrooms: 4 }),
    ),
  ]),
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node_: React.ReactElement): string {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container as HTMLDivElement);
    root.render(node_);
  });
  return (container as HTMLDivElement).textContent ?? "";
}

const click = (el: Element | null | undefined) =>
  act(() => {
    (el as HTMLElement)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

const buttons = () => [...(container?.querySelectorAll("button") ?? [])];

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const panel = (tree: TreeNode[], path: TreeNode[], over: Record<string, unknown> = {}) => (
  <HierarchyPanel
    roots={tree}
    path={path}
    derived={false}
    month="2026-09"
    onGo={() => {}}
    onOpen={() => {}}
    {...over}
  />
);

describe("HierarchyPanel", () => {
  it("shows ONE level at a time — not four tables at once", () => {
    const tree = roots();
    const out = render(panel(tree, collapseFrom(tree, [])));
    // Open on the first level that actually branches: departments.
    expect(out).toContain("English");
    expect(out).toContain("Math");
    // And nothing from the levels above or below is in the table.
    expect(container?.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(container?.textContent).not.toContain("Fergana 12-A");
    expect(container?.textContent).not.toContain("Nodira Yusupova");
  });

  it("keeps the passed-through levels in the breadcrumb, so the structure stays visible", () => {
    const tree = roots();
    render(panel(tree, collapseFrom(tree, [])));
    const trail = container?.querySelector("nav")?.textContent ?? "";
    expect(trail).toContain("All regions");
    expect(trail).toContain("Fergana");
    expect(trail).toContain("Fergana city");
  });

  it("says whose numbers the table is showing, and states that node's own rate", () => {
    const tree = roots();
    const out = render(panel(tree, collapseFrom(tree, [])));
    // The tiles above the page are the whole school wherever the reader is; the card has to
    // say what IT is, or a department's table reads as the school's own figures.
    expect(out).toContain("Departments in Fergana city");
    expect(out).toContain("branch total");
    expect(out).toContain("75%");
    expect(out).toContain("45 of 60 students");
  });

  it("names the level in the column header rather than showing a bare list", () => {
    const tree = roots();
    render(panel(tree, collapseFrom(tree, [])));
    const headers = [...(container?.querySelectorAll("thead th") ?? [])].map((h) => h.textContent);
    expect(headers).toContain("Department");
    expect(headers).toContain("Pass rate");
    // The last column says what is one level further down.
    expect(headers).toContain("Teachers");
  });

  it("descends when a row is clicked, and hands back the node that was clicked", () => {
    const onOpen = vi.fn();
    const tree = roots();
    render(panel(tree, collapseFrom(tree, []), { onOpen }));
    const row = buttons().find((b) => b.textContent?.includes("English"));
    click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].key).toBe("department:ENGLISH");
  });

  it("goes back to the level a crumb names, by depth", () => {
    const onGo = vi.fn();
    const tree = roots();
    render(panel(tree, collapseFrom(tree, []), { onGo }));
    click(buttons().find((b) => b.textContent?.includes("Fergana city")));
    // Two crumbs kept: Fergana, Fergana city — the reader asked for the branch's own level.
    expect(onGo).not.toHaveBeenCalled();
    click(buttons().find((b) => b.textContent?.trim() === "Fergana"));
    expect(onGo).toHaveBeenCalledWith(1);
    click(buttons().find((b) => b.textContent?.includes("All regions")));
    expect(onGo).toHaveBeenLastCalledWith(0);
  });

  it("keeps every count a rate is made of, at every level", () => {
    const tree = roots();
    const out = render(panel(tree, collapseFrom(tree, [])));
    expect(out).toContain("70%");
    expect(out).toContain("28 of 40");
    expect(out).toContain("1 teacher");
  });

  it("shows the papers column at the class level, not a child count", () => {
    const tree = roots();
    const path = [tree[0], tree[0].children![0], tree[0].children![0].children![0]];
    render(panel(tree, collapseFrom(tree, path)));
    const headers = [...(container?.querySelectorAll("thead th") ?? [])].map((h) => h.textContent);
    expect(headers).toContain("Class");
    expect(headers).toContain("Papers");
    expect(container?.textContent).toContain("Fergana 12-A");
    expect(container?.textContent).toContain("Advanced");
  });

  it("marks an Unassigned bucket as the gap it is rather than dropping it", () => {
    const tree = roots();
    tree[0].children!.push(node("branch:none", "branch", "Unassigned", [
      node("department:X", "department", "Math", [], { id: null }),
    ], { id: null }));
    const out = render(panel(tree, [tree[0]]));
    expect(out).toContain("Unassigned");
    expect(out).toContain("Data gap");
    expect(out).toContain("never backfilled");
  });


  it("renders an unmeasured row as an em dash, never as 0%, and draws no bar for it", () => {
    const tree = roots();
    tree[0].children![0].children![1] = node("department:MATH", "department", "Math", [], {
      id: null,
      ...tally({
        roster: 0,
        attended: 0,
        passed: 0,
        passed_first: 0,
        passed_retake: 0,
        failed: 0,
        retake_taken: 0,
        retake_passed: 0,
        pass_rate: null,
        attendance_rate: null,
        first_try_share: null,
        retake_share: null,
        distinct_students: 0,
        classrooms: 0,
      }),
    });
    const out = render(panel(tree, collapseFrom(tree, [])));
    expect(out).toContain("—");
    expect(out).toContain("due to sit an exam");
    // A coloured bar beside an em dash is a picture of 0%, which is the claim the dash exists
    // to avoid. The row's bar is the split one (passed | failed | did not come), and for a
    // node nobody was due to sit under it must draw an empty track and no segments at all.
    const rows = [...(container?.querySelectorAll("tbody tr") ?? [])];
    const math = rows.find((r) => r.textContent?.includes("Math"));
    expect(math?.querySelectorAll('[role="img"]')).toHaveLength(0);
    const english = rows.find((r) => r.textContent?.includes("English"));
    const bar = english!.querySelector('[role="img"]');
    expect(bar).not.toBeNull();
    expect(bar!.querySelectorAll("span").length).toBeGreaterThan(0);
  });

  it("reconciles the two denominators when a row shows both", () => {
    const tree = roots();
    const out = render(panel(tree, collapseFrom(tree, [])));
    // 40 exams expected of 34 students: a student in two of these classes is counted in both.
    expect(out).toContain("34 students");
    expect(out).toContain("40 exams expected");
    expect(out).toContain("sat more than one exam this month, and each exam counts");
  });

  it("draws each row's bar just after the row it belongs to, and caps the wait", () => {
    const tree = roots();
    render(panel(tree, collapseFrom(tree, [])));
    const rows = [...(container?.querySelectorAll("tbody tr") ?? [])];
    const ms = (el: Element | null, prop: string) =>
      Number(((el as HTMLElement | null)?.style.getPropertyValue(prop) || "0ms").replace("ms", ""));

    rows.forEach((tr, i) => {
      const rowIn = Number((tr as HTMLElement).style.animationDelay.replace("ms", ""));
      const bar = ms(tr.querySelector(".mts-grow"), "--mts-delay");
      // The bar is drawn after its row has arrived, never before it.
      expect(bar).toBeGreaterThan(rowIn);
      // And nothing waits on a stagger longer than a dozen rows' worth.
      expect(rowIn).toBeLessThanOrEqual(12 * 35);
      expect(i).toBeGreaterThanOrEqual(0);
    });
  });

  it("says out loud when it had to rebuild the hierarchy itself", () => {
    const tree = roots();
    const out = render(panel(tree, collapseFrom(tree, []), { derived: true }));
    expect(out).toContain("This hierarchy was rebuilt in the browser");
  });
});
