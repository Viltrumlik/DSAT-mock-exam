/**
 * The two rules that decide what the drill-down shows, and the arithmetic behind a node.
 *
 * The collapsing rule is the one that is easy to get wrong in a way nobody notices: hard-code
 * "skip region and branch" and the page looks perfect today — one region, one branch — and
 * silently keeps skipping the day a second branch is created, hiding a whole level of the
 * school from the people who opened a second branch. So the rule is asserted against the
 * SHAPE of the data, twice: once for the school as it is, and once for the school as it will
 * be.
 */
import { describe, expect, it } from "vitest";

import {
  childCountLabel,
  collapseFrom,
  deriveTree,
  hierarchyFor,
  isGapNode,
  nodeSubline,
  resolvePath,
  viewAt,
} from "../tree";
import type { ClassroomRow, GroupTally, MonthlyStats, TreeLevel, TreeNode } from "../types";

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

const cls = (over: Partial<ClassroomRow> = {}): ClassroomRow => ({
  id: 11,
  name: "Fergana 12-A",
  subject: "ENGLISH",
  subject_label: "English",
  level: "advanced",
  level_label: "Advanced",
  teacher: { id: 5, name: "Nodira Yusupova" },
  branch: { id: 1, name: "Fergana city", region: "Fergana" },
  midterms: 1,
  ...tally(),
  ...over,
});

/** Production today: one region, one branch, two departments under it. */
const oneBranchTree = () => [
  node("region:1", "region", "Fergana", [
    node("branch:1", "branch", "Fergana city", [
      node("department:1:ENGLISH", "department", "English", [
        node("teacher:5", "teacher", "Nodira Yusupova", [
          node("classroom:11", "classroom", "Fergana 12-A", [], { id: 11 }),
        ]),
      ], { id: null }),
      node("department:1:MATH", "department", "Math", [
        node("teacher:6", "teacher", "Sardor Umarov", [
          node("classroom:12", "classroom", "Fergana 9-B", [], { id: 12 }),
        ]),
      ], { id: null }),
    ]),
  ]),
];

describe("the collapsing rule", () => {
  it("passes through every level that has exactly one child", () => {
    const roots = oneBranchTree();
    const path = collapseFrom(roots, []);
    // One region, one branch: two clicks that would reveal nothing.
    expect(path.map((n) => n.name)).toEqual(["Fergana", "Fergana city"]);
    // And the page therefore opens on the first level that actually branches.
    expect(viewAt(roots, path).level).toBe("department");
    expect(viewAt(roots, path).rows.map((r) => r.name)).toEqual(["English", "Math"]);
  });

  it("stops collapsing the day a second branch exists — nothing here is hard-coded", () => {
    const roots = oneBranchTree();
    roots[0].children!.push(node("branch:2", "branch", "Margilan", [
      node("department:2:MATH", "department", "Math", [], { id: null }),
    ]));
    const path = collapseFrom(roots, []);
    expect(path.map((n) => n.name)).toEqual(["Fergana"]);
    expect(viewAt(roots, path).level).toBe("branch");
  });

  it("never skips INTO a class: a lone classroom is a row to click, not a level", () => {
    const roots = oneBranchTree();
    const teacher = roots[0].children![0].children![0].children![0];
    const path = collapseFrom(roots, [roots[0], roots[0].children![0], roots[0].children![0].children![0]]);
    expect(path[path.length - 1]).toBe(teacher);
    expect(viewAt(roots, path).level).toBe("classroom");
  });
});

describe("resolvePath", () => {
  it("follows node keys down the tree", () => {
    const roots = oneBranchTree();
    const path = resolvePath(roots, ["region:1", "branch:1", "department:1:MATH"]);
    expect(path.map((n) => n.name)).toEqual(["Fergana", "Fergana city", "Math"]);
  });

  it("degrades to the deepest position that still exists rather than to a blank table", () => {
    const roots = oneBranchTree();
    const path = resolvePath(roots, ["region:1", "branch:99", "department:1:MATH"]);
    expect(path.map((n) => n.name)).toEqual(["Fergana"]);
  });

  it("refuses to stand inside a classroom — a leaf has no table", () => {
    const roots = oneBranchTree();
    const path = resolvePath(roots, [
      "region:1",
      "branch:1",
      "department:1:ENGLISH",
      "teacher:5",
      "classroom:11",
    ]);
    expect(path[path.length - 1].key).toBe("teacher:5");
  });
});

describe("hierarchyFor", () => {
  const stats = (over: Partial<MonthlyStats>): MonthlyStats =>
    ({
      month: "2026-09",
      definition: {},
      is_future: false,
      future_months: [],
      this_month: "2026-09",
      orphan_retakes: [],
      totals: { ...tally(), midterms: 1 },
      branches: [],
      departments: [],
      teachers: [],
      classrooms: [],
      months: ["2026-09"],
      filters: { branch: null, subject: null, teacher: null },
      ...over,
    }) as MonthlyStats;

  it("opens where the payload says, and finishes the descent itself", () => {
    const tree = oneBranchTree();
    // The server sent only the region; the branch below it still has one child.
    const h = hierarchyFor(stats({ tree, tree_open_path: ["region:1"] }));
    expect(h.derived).toBe(false);
    expect(h.openPath.map((n) => n.name)).toEqual(["Fergana", "Fergana city"]);
  });

  it("derives the whole path when the payload sends none", () => {
    const h = hierarchyFor(stats({ tree: oneBranchTree() }));
    expect(h.openPath.map((n) => n.name)).toEqual(["Fergana", "Fergana city"]);
  });

  it("rebuilds a tree from the classroom list when the payload carries none", () => {
    const h = hierarchyFor(
      stats({
        classrooms: [
          cls(),
          cls({ id: 12, name: "Fergana 9-B", subject: "MATH", subject_label: "Math" }),
        ],
      }),
    );
    expect(h.derived).toBe(true);
    expect(h.roots.map((n) => n.name)).toEqual(["Fergana"]);
    // A missing hierarchy must never render as an empty school.
    expect(viewAt(h.roots, h.openPath).rows.map((r) => r.name).sort()).toEqual([
      "English",
      "Math",
    ]);
  });
});

describe("deriveTree", () => {
  it("pools by addition and recomputes the rate — never an average of percentages", () => {
    const roots = deriveTree([
      cls({ id: 11, ...tally({ roster: 4, passed: 4, passed_first: 4, passed_retake: 0, failed: 0, distinct_students: 4 }) }),
      cls({ id: 12, name: "B", ...tally({ roster: 30, passed: 15, passed_first: 15, passed_retake: 0, failed: 15, distinct_students: 30 }) }),
    ]);
    // A mean of 100% and 50% would be 75%. Pooled: 19 of 34.
    expect(roots[0].passed).toBe(19);
    expect(roots[0].roster).toBe(34);
    expect(roots[0].pass_rate).toBe(55.9);
  });

  it("returns null, never 0%, for a node with nobody on its roster", () => {
    const roots = deriveTree([
      cls({ ...tally({ roster: 0, passed: 0, passed_first: 0, passed_retake: 0, failed: 0, attended: 0, distinct_students: 0 }) }),
    ]);
    expect(roots[0].pass_rate).toBeNull();
    expect(roots[0].first_try_share).toBeNull();
  });

  it("keeps the classes with no branch, under an Unassigned region and branch", () => {
    const roots = deriveTree([cls(), cls({ id: 12, name: "Orphan", branch: null })]);
    const names = roots.map((r) => r.name);
    expect(names).toContain("Unassigned");
    const gap = roots.find((r) => r.name === "Unassigned")!;
    expect(isGapNode(gap)).toBe(true);
    expect(gap.children![0].name).toBe("Unassigned");
  });

  it("never prints a headcount it had to add up itself", () => {
    // Two classes, 10 students each, but the same student may be in both — a rebuilt node
    // cannot tell, and 112 of the school's 226 students really are in two classes.
    const roots = deriveTree([cls(), cls({ id: 12, name: "B" })]);
    expect(nodeSubline(roots[0])).toBe("2 classes · 20 exams expected");
    expect(nodeSubline(roots[0])).not.toContain("students");
    // The class itself is exact, because that number came straight off its own row.
    const leaf = roots[0].children![0].children![0].children![0].children![0];
    expect(nodeSubline(leaf)).toContain("10 students");
  });
});

describe("what a row says about what is inside it", () => {
  it("counts children in the child's own words", () => {
    const roots = oneBranchTree();
    expect(childCountLabel(roots[0])).toBe("1 branch");
    expect(childCountLabel(roots[0].children![0])).toBe("2 departments");
    expect(childCountLabel(roots[0].children![0].children![0])).toBe("1 teacher");
  });

  it("does not call a department a data gap just because it has no record id", () => {
    const department = oneBranchTree()[0].children![0].children![0];
    expect(department.id).toBeNull();
    expect(isGapNode(department)).toBe(false);
  });
});

/**
 * The exact bytes `_Node.payload()` emits, and the two absences in it.
 *
 * The backend omits `children` on a leaf rather than sending `[]` ("an empty list would render
 * as a node that can be expanded onto nothing"), and sends no `child_level` at all. A page
 * that reads either as required would show an empty table at the class level and a blank
 * column header one level up — both of which look like data, not like a missing key.
 */
describe("the payload the backend actually sends", () => {
  const backendShaped = (): TreeNode[] => [
    {
      ...tally(),
      key: "region:1",
      level: "region",
      id: 1,
      name: "Fergana",
      midterms: 4,
      children: [
        {
          ...tally(),
          key: "branch:1",
          level: "branch",
          id: 1,
          name: "Fergana city",
          midterms: 4,
          children: [
            {
              ...tally(),
              key: "department:MATH",
              level: "department",
              id: null,
              name: "Math",
              subject: "MATH",
              midterms: 2,
              children: [
                {
                  ...tally(),
                  key: "teacher:5",
                  level: "teacher",
                  id: 5,
                  name: "Nodira Yusupova",
                  midterms: 2,
                  children: [
                    // A leaf: no `children` key at all, and no `child_level` anywhere.
                    {
                      ...tally(),
                      key: "classroom:11",
                      level: "classroom",
                      id: 11,
                      name: "Fergana 12-A",
                      midterms: 2,
                      subject_label: "Math",
                      level_label: "Advanced",
                    },
                  ],
                },
              ],
            },
            {
              ...tally(),
              key: "department:ENGLISH",
              level: "department",
              id: null,
              name: "English",
              subject: "ENGLISH",
              midterms: 2,
              children: [
                {
                  ...tally(),
                  key: "teacher:unassigned",
                  level: "teacher",
                  id: null,
                  name: "Unassigned",
                  midterms: 2,
                  children: [
                    {
                      ...tally(),
                      key: "classroom:12",
                      level: "classroom",
                      id: 12,
                      name: "Fergana 9-B",
                      midterms: 2,
                      subject_label: "English",
                      level_label: "Beginner",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  it("collapses to Departments with no child_level to read", () => {
    const roots = backendShaped();
    const path = collapseFrom(roots, []);
    expect(path.map((n) => n.name)).toEqual(["Fergana", "Fergana city"]);
    const view = viewAt(roots, path);
    expect(view.level).toBe("department");
    // The column header for "what is inside" is read off the children, not off a sent key.
    expect(view.kidLevel).toBe("teacher");
  });

  it("treats a leaf with no children key as a leaf, not as an empty level", () => {
    const roots = backendShaped();
    const teacher = roots[0].children![0].children![0].children![0];
    // Descending into that teacher must land ON the classes, never inside one.
    const path = collapseFrom(roots, [
      roots[0],
      roots[0].children![0],
      roots[0].children![0].children![0],
    ]);
    expect(path[path.length - 1]).toBe(teacher);
    const view = viewAt(roots, path);
    expect(view.level).toBe("classroom");
    expect(view.kidLevel).toBeNull();
    expect(view.rows.map((r) => r.name)).toEqual(["Fergana 12-A"]);
    expect(childCountLabel(teacher)).toBe("1 class");
  });

  it("reads the backend's own Unassigned key as a gap, and a department as not one", () => {
    const roots = backendShaped();
    const departments = roots[0].children![0].children!;
    expect(departments.every(isGapNode)).toBe(false);
    expect(isGapNode(departments[1].children![0])).toBe(true);
  });
});
