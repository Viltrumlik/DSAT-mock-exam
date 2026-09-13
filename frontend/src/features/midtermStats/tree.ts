/**
 * The hierarchy behind the drill-down: which node contains which, and where the page opens.
 *
 * The page this replaces showed four flat sibling tables — Branches, Departments, Teachers,
 * Classes — all at once, with no relationship drawn between them. Every one of them was a
 * different slice of the same classrooms, so a reader comparing a teacher's row to a branch's
 * row had no way to know whether the teacher was IN that branch. The owner's word for it was
 * *murakkab*: complicated. The fix he asked for is the containment chain the school actually
 * has, one level at a time.
 *
 * Pure: no React, no fetching. Two rules live here and nowhere else.
 *
 * 1. **A level with exactly one child is passed through, not clicked through.** Today the
 *    school has one region and one branch, so two clicks would reveal nothing; the page opens
 *    on Departments instead, with `Fergana › Fergana city` still in the breadcrumb so the
 *    structure is visible and starts working on its own the day a second branch exists. The
 *    rule is derived from the data every time ({@link collapseFrom}) — never a hard-coded
 *    "skip region and branch".
 * 2. **A node is the merge of its descendants, and a rate is recomputed, never averaged.**
 *    `Tally` adds field-wise, so pooling up the tree is just addition; `pass_rate` is then
 *    `passed / roster` at that node. A mean of percentages would let a 4-student class weigh
 *    the same as a 30-student one.
 */
import { UNASSIGNED, plural } from "./format";
import type {
  ClassroomRow,
  GroupTally,
  MonthlyStats,
  TreeLevel,
  TreeNode,
} from "./types";

/** The words each level goes by on screen. No raw enum, at any altitude. */
export const LEVEL_NOUN: Record<TreeLevel, { one: string; many: string }> = {
  region: { one: "region", many: "regions" },
  branch: { one: "branch", many: "branches" },
  department: { one: "department", many: "departments" },
  teacher: { one: "teacher", many: "teachers" },
  classroom: { one: "class", many: "classes" },
};

const capitalise = (word: string) => word[0].toUpperCase() + word.slice(1);

/** "Branches", "Classes" — the child-count column's header and the table's own title. */
export function levelHeading(level: TreeLevel): string {
  return capitalise(LEVEL_NOUN[level].many);
}

/** "Branch", "Class" — the name column's header, which describes one row. */
export function levelColumnHeading(level: TreeLevel): string {
  return capitalise(LEVEL_NOUN[level].one);
}

/**
 * How the table names its scope: "Departments in Fergana city", "Classes taught by Nodira".
 *
 * A teacher does not CONTAIN classes the way a branch contains departments, and a heading
 * that says so reads as the sentence the reader is actually inside.
 */
export function scopeHeading(childLevel: TreeLevel, parent: TreeNode | null): string {
  const heading = levelHeading(childLevel);
  if (!parent) return heading;
  if (parent.level === "teacher") return `${heading} taught by ${parent.name}`;
  return `${heading} in ${parent.name}`;
}

export const MAX_DEPTH = 5;

export const children = (node: TreeNode): TreeNode[] => node.children ?? [];

/**
 * The level of a node's children: what the server said, else what the children themselves
 * say, else null for a leaf.
 *
 * Read rather than required so one missing optional key cannot blank a column.
 */
export function childLevel(node: TreeNode): TreeLevel | null {
  if (node.child_level) return node.child_level;
  return children(node)[0]?.level ?? null;
}

/**
 * A row whose identity is a known gap in the record, not a group.
 *
 * A classroom with no branch has no region either, and a classroom with no teacher lands in
 * an unassigned teacher bucket — both are `id: null`. A **department** node is also `id: null`
 * (subject is not a record) and is emphatically not a gap, which is why this asks the level
 * rather than reusing `isUnassigned` from the flat tables.
 */
export function isGapNode(node: TreeNode): boolean {
  if (node.level === "department" || node.level === "classroom") return false;
  return node.id == null || node.name === UNASSIGNED;
}

/**
 * The sub-line under a node's name: what it is pooled over.
 *
 * A classroom leaf names itself instead (its level and subject), because "1 class" under the
 * name of a class says nothing. A node the page had to rebuild itself omits the headcount —
 * see {@link deriveTree}.
 */
export function nodeSubline(node: TreeNode): string {
  const parts: string[] = [];
  if (node.level === "classroom") {
    if (node.level_label) parts.push(node.level_label);
    if (node.subject_label) parts.push(node.subject_label);
  } else {
    parts.push(plural(node.classrooms, "class", "classes"));
  }
  // A derived interior node's `distinct_students` is a sum, and a student in two of its
  // classes has been counted twice in it. Printing that under the word "students" would be
  // the exact mistake the roster/headcount pair exists to prevent, so it is not printed.
  const headcountKnown = !node.derived || node.level === "classroom";
  if (headcountKnown) parts.push(plural(node.distinct_students, "student"));
  if (node.roster !== node.distinct_students || !headcountKnown) {
    parts.push(`${plural(node.roster, "exam")} expected`);
  }
  return parts.join(" · ");
}

/** "3 branches", "12 classes" — what descending into this row would show. */
export function childCountLabel(node: TreeNode): string {
  const level = childLevel(node);
  const count = children(node).length;
  if (!level) return "";
  return plural(count, LEVEL_NOUN[level].one, LEVEL_NOUN[level].many);
}

/* ── walking the tree ───────────────────────────────────────────────────────────────── */

/**
 * Follow a list of node keys down from the roots, stopping at the first one that is not
 * there.
 *
 * A path can go stale between renders — a month switch replaces every node — and a stale key
 * must degrade to "one level shallower", never to a blank table.
 */
export function resolvePath(roots: TreeNode[], keys: readonly string[]): TreeNode[] {
  const path: TreeNode[] = [];
  let level = roots;
  for (const key of keys.slice(0, MAX_DEPTH)) {
    const found = level.find((n) => n.key === key);
    if (!found) break;
    path.push(found);
    level = children(found);
  }
  // A path that ends on a leaf has no table to show. A classroom is opened by its own panel,
  // never by standing inside it.
  while (path.length > 0 && children(path[path.length - 1]).length === 0) path.pop();
  return path;
}

/**
 * Rule 1, applied: keep descending while the level below has exactly one node that itself
 * contains something.
 *
 * A lone CLASSROOM is deliberately not skipped into — a one-row table of classes is a row a
 * reader can click, and auto-opening a class's drill-down from the top of the page would be a
 * navigation nobody asked for.
 */
export function collapseFrom(roots: TreeNode[], path: readonly TreeNode[]): TreeNode[] {
  const out = [...path];
  for (let i = 0; i < MAX_DEPTH; i += 1) {
    const level = out.length > 0 ? children(out[out.length - 1]) : roots;
    if (level.length !== 1) break;
    const only = level[0];
    if (children(only).length === 0) break;
    out.push(only);
  }
  return out;
}

/**
 * Everything one position in the tree implies: whose children are on screen, what they are,
 * and what is one step further down.
 *
 * Computed in one place because the page and the panel must agree about it — the chart above
 * the table plots the same rows the table lists, and a chart of a different level than the
 * table under it is exactly the confusion this rebuild removes.
 */
export type TreeView = {
  /** The node the reader is standing in. `null` at the top level. */
  parent: TreeNode | null;
  rows: TreeNode[];
  /** The level of `rows`. */
  level: TreeLevel;
  /** The level below `rows`, for the "what is inside" column. `null` at the leaves. */
  kidLevel: TreeLevel | null;
};

export function viewAt(roots: TreeNode[], path: readonly TreeNode[]): TreeView {
  const parent = path.length > 0 ? path[path.length - 1] : null;
  const rows = parent ? children(parent) : roots;
  const level = (parent ? childLevel(parent) : (roots[0]?.level ?? null)) ?? "classroom";
  const kidLevel = rows.map(childLevel).find(Boolean) ?? null;
  return { parent, rows, level, kidLevel };
}

/* ── building one, when the payload did not carry it ────────────────────────────────── */

const round1 = (n: number) => Math.round(n * 10) / 10;

const SUMMED = [
  "roster",
  "attended",
  "passed_first",
  "passed_retake",
  "failed",
  "absent",
  "pending",
  "retake_taken",
  "retake_passed",
  "retake_failed",
  "passed",
  "classrooms",
  "distinct_students",
] as const;

/**
 * Merge tallies field-wise and recompute the rates — the same arithmetic the backend's
 * `Tally.merged` does.
 *
 * `distinct_students` is summed here because there is nothing else to do with it, and that
 * sum is why every node built this way is flagged `derived` and never shows a headcount.
 */
function mergeTallies(rows: readonly GroupTally[]): GroupTally {
  const out = Object.fromEntries(SUMMED.map((k) => [k, 0])) as Record<string, number>;
  for (const row of rows) for (const k of SUMMED) out[k] += row[k] ?? 0;
  const { roster, passed, attended, passed_first } = out;
  const first = passed > 0 ? round1((passed_first / passed) * 100) : null;
  return {
    ...(out as unknown as Omit<
      GroupTally,
      "pass_rate" | "attendance_rate" | "first_try_share" | "retake_share"
    >),
    // Empty denominator is null, never 0: a node with nobody on its roster has not failed
    // everyone, and the page renders null as an em dash.
    pass_rate: roster > 0 ? round1((passed / roster) * 100) : null,
    attendance_rate: roster > 0 ? round1((attended / roster) * 100) : null,
    first_try_share: first,
    // Taken from 100 rather than computed separately so the pair always sums to exactly 100,
    // as the backend guarantees.
    retake_share: first == null ? null : round1(100 - first),
  };
}

const nodeOf = (
  key: string,
  level: TreeLevel,
  id: number | null,
  name: string,
  kids: TreeNode[],
): TreeNode => ({
  ...mergeTallies(kids),
  key,
  level,
  id,
  name,
  children: kids,
  child_level: kids[0]?.level ?? null,
  derived: true,
});

/** Best first, then by name — the order every ranked list on this page already uses. */
function rankNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (isGapNode(a) !== isGapNode(b)) return isGapNode(a) ? 1 : -1;
    const ar = a.pass_rate ?? -1;
    const br = b.pass_rate ?? -1;
    if (ar !== br) return br - ar;
    if (a.roster !== b.roster) return b.roster - a.roster;
    return a.name.localeCompare(b.name);
  });
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}

/**
 * The hierarchy, rebuilt in the browser from the flat classroom list.
 *
 * This is the fallback for a payload that carries no `tree` — an older backend, or a contract
 * that moved. It exists because the alternative is worse than imperfect numbers: a page that
 * renders nothing when a key is missing shows an EMPTY SCHOOL, and on this page an empty
 * table is read as a finding about the classes that are not in it.
 *
 * Everything except one field is exact, because every count in a classroom row adds. The
 * exception is `distinct_students`: a student in two classrooms is one student and two roster
 * places, and no amount of arithmetic over the flat rows recovers that. So each node built
 * here is marked `derived`, its headcount is never printed, and the page says out loud that
 * it built this itself.
 */
export function deriveTree(classrooms: readonly ClassroomRow[]): TreeNode[] {
  const leaf = (row: ClassroomRow): TreeNode => ({
    ...(row as GroupTally),
    key: `classroom:${row.id}`,
    level: "classroom",
    id: row.id,
    name: row.name,
    children: [],
    child_level: null,
    subject_label: row.subject_label,
    level_label: row.level_label,
    midterms: row.midterms,
    // A classroom's own headcount IS exact — it came straight off its row.
    derived: false,
  });

  const byRegion = groupBy(classrooms, (c) => c.branch?.region ?? UNASSIGNED);
  const regions: TreeNode[] = [];
  for (const [regionName, inRegion] of byRegion) {
    const byBranch = groupBy(inRegion, (c) => (c.branch ? String(c.branch.id) : "none"));
    const branches: TreeNode[] = [];
    for (const [branchKey, inBranch] of byBranch) {
      const branch = inBranch[0].branch;
      const bySubject = groupBy(inBranch, (c) => c.subject);
      const departments: TreeNode[] = [];
      for (const [subject, inSubject] of bySubject) {
        const byTeacher = groupBy(inSubject, (c) =>
          c.teacher ? String(c.teacher.id) : "none",
        );
        const teachers: TreeNode[] = [];
        for (const [teacherKey, inTeacher] of byTeacher) {
          const teacher = inTeacher[0].teacher;
          teachers.push(
            nodeOf(
              `teacher:${branchKey}:${subject}:${teacherKey}`,
              "teacher",
              teacher?.id ?? null,
              teacher?.name ?? UNASSIGNED,
              rankNodes(inTeacher.map(leaf)),
            ),
          );
        }
        departments.push(
          nodeOf(
            `department:${branchKey}:${subject}`,
            "department",
            null,
            inSubject[0].subject_label || subject,
            rankNodes(teachers),
          ),
        );
      }
      branches.push(
        nodeOf(
          `branch:${branchKey}`,
          "branch",
          branch?.id ?? null,
          branch?.name ?? UNASSIGNED,
          rankNodes(departments),
        ),
      );
    }
    regions.push(
      nodeOf(
        `region:${regionName}`,
        "region",
        regionName === UNASSIGNED ? null : 1,
        regionName,
        rankNodes(branches),
      ),
    );
  }
  return rankNodes(regions);
}

export type Hierarchy = {
  roots: TreeNode[];
  /** True when the page built this itself because the payload carried none. */
  derived: boolean;
  /** Where the page opens: the payload's path, collapsed the rest of the way. */
  openPath: TreeNode[];
};

/**
 * The tree the page draws, and the path it opens on.
 *
 * The server's `tree_open_path` is honoured first — it is the one that knows about nodes the
 * page cannot see — and then {@link collapseFrom} finishes the descent from wherever that
 * left off. Both directions matter: a payload that sends no path still opens at the first
 * level that branches, and a payload whose path is one level short is not left showing a
 * one-row table.
 */
export function hierarchyFor(stats: MonthlyStats | null | undefined): Hierarchy {
  const sent = stats?.tree;
  const derived = !Array.isArray(sent) || sent.length === 0;
  const roots = derived ? deriveTree(stats?.classrooms ?? []) : (sent as TreeNode[]);
  const fromPayload = resolvePath(roots, stats?.tree_open_path ?? []);
  return { roots, derived, openPath: collapseFrom(roots, fromPayload) };
}
