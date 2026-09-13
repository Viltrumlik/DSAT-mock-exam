"use client";

import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  UNASSIGNED_BRANCH_NOTE,
  UNASSIGNED_TEACHER_NOTE,
  formatShare,
  monthLabel,
  plural,
  rateReason,
} from "./format";
import { DenominatorNote, anyPending, tallyColumns } from "./RankTables";
import {
  EmptyPanel,
  GapMarker,
  Num,
  RankedTable,
  Rank,
  RateFigure,
  SectionCard,
} from "./StatsUI";
import type { RankedColumn } from "./StatsUI";
import {
  LEVEL_NOUN,
  childCountLabel,
  children,
  isGapNode,
  levelColumnHeading,
  levelHeading,
  nodeSubline,
  scopeHeading,
  viewAt,
} from "./tree";
import type { MonthKey, TreeLevel, TreeNode } from "./types";

/**
 * The drill-down: one table at a time, showing what is inside the node you are standing in.
 *
 * The owner's request, in full: *"regionlar birinchi ko'rinsin ularni ichida branchlar
 * ko'rinsin ularni ustiga bossa ichida departmentlar ko'rinsin, ularni ichida teacherlar,
 * ularni ichida classroomlar"* — regions first, branches inside them, departments inside a
 * branch you click, teachers inside those, classrooms inside those. What it replaces is four
 * flat sibling tables printed one under another, none of which said whether the teacher in
 * the third table taught in the branch in the first.
 *
 * Three things hold the reading together:
 *
 * 1. **The breadcrumb is always complete**, including a level the collapsing rule passed
 *    through. Today the page opens on Departments with `Fergana › Fergana city` already in
 *    it: the school has one region and one branch, and two clicks that reveal nothing would
 *    be worse than none. The crumb is what keeps the structure visible anyway — and what
 *    starts working on its own the day a second branch is created.
 * 2. **Going up is literal, going down collapses.** Clicking a crumb lands exactly there,
 *    even when that is a one-row table, because the reader asked for that level. Descending
 *    skips a level with a single child, because nobody asks for a click that reveals nothing.
 *    Both are decided by the data (`tree.ts`), never by a hard-coded list of levels.
 * 3. **The card states whose numbers these are.** The tiles at the top of the page are the
 *    whole school's wherever the reader has drilled to; a table of a department's classes
 *    sitting under them would otherwise be read as the school's own figures one scroll down.
 */

/** The path across the top. Every crumb goes back to that level; the last one is where you are. */
export function HierarchyBreadcrumb({
  path,
  rootLabel,
  onGo,
}: {
  path: readonly TreeNode[];
  /** What the top level is called — "All regions", or "All branches" for a school with none. */
  rootLabel: string;
  /** `depth` is how many crumbs to keep: 0 is the top level. */
  onGo: (depth: number) => void;
}) {
  const crumb = (
    key: string,
    label: string,
    depth: number,
    current: boolean,
    icon?: boolean,
  ) => (
    <li key={key} className="flex min-w-0 items-center gap-1">
      {depth > 0 ? (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
      {current ? (
        <span
          aria-current="page"
          className="inline-flex min-w-0 items-center gap-1 px-1.5 py-0.5 font-bold text-foreground"
        >
          {icon ? <Home className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
          <span className="truncate">{label}</span>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onGo(depth)}
          className="ds-ring inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          {icon ? <Home className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
          <span className="truncate">{label}</span>
        </button>
      )}
    </li>
  );

  return (
    <nav aria-label="Where you are">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px]">
        {crumb("__root", rootLabel, 0, path.length === 0, true)}
        {path.map((node, i) =>
          crumb(node.key, node.name, i + 1, i === path.length - 1, false),
        )}
      </ol>
    </nav>
  );
}

/**
 * The current node's OWN pooled figure, in the card header beside the table's title.
 *
 * The five tiles above the page never change scope — they are the whole school, on purpose,
 * so a reader always has the total to compare against. That is exactly why this has to exist:
 * without it, "72.4%" in 30px type sits directly above a table of one department's classes,
 * and the two are read as the same claim.
 */
function ScopeFigure({ node }: { node: TreeNode }) {
  return (
    <div className="text-right">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {LEVEL_NOUN[node.level].one} total
      </p>
      <p className="mt-0.5 text-xl font-extrabold tabular-nums text-foreground">
        <RateFigure rate={node.pass_rate} reason={rateReason("pass", node.roster)} />
      </p>
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {formatShare(node.passed, node.roster)} students
      </p>
    </div>
  );
}

/** What "Unassigned" means at this level. A real gap in the record, never a zero. */
function gapNote(level: TreeLevel): string {
  if (level === "teacher") return UNASSIGNED_TEACHER_NOTE;
  if (level === "region") {
    return `Classrooms with no branch set, so they sit under no region either. ${UNASSIGNED_BRANCH_NOTE}`;
  }
  return UNASSIGNED_BRANCH_NOTE;
}

/** The row's name, as the button that descends into it (or opens a class's month). */
function NodeNameButton({ node, onOpen }: { node: TreeNode; onOpen: (node: TreeNode) => void }) {
  const leaf = node.level === "classroom";
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => onOpen(node)}
        className="ds-ring group -mx-1 flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-0.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2 truncate font-bold text-foreground group-hover:text-primary">
          {node.name}
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary"
            aria-hidden
          />
        </span>
        <span className="sr-only">
          {leaf
            ? "Open this class’s month in detail"
            : `Show the ${childCountLabel(node)} inside ${node.name}`}
        </span>
      </button>
      <p className="mt-0.5 flex items-center gap-2 truncate text-[12px] text-muted-foreground">
        <span className="truncate">{nodeSubline(node)}</span>
        {isGapNode(node) ? <GapMarker note={gapNote(node.level)} /> : null}
      </p>
    </div>
  );
}

/** One level of the tree, ranked, with the counts every rate is made of. */
function HierarchyTable({
  rows,
  level,
  kidLevel,
  onOpen,
}: {
  rows: TreeNode[];
  /** The level of these rows — read from the parent, so an empty table still knows its noun. */
  level: TreeLevel;
  /** The level one further down, for the "what is inside" column. Null at the leaves. */
  kidLevel: TreeLevel | null;
  onOpen: (node: TreeNode) => void;
}) {
  const leaf = level === "classroom";

  const columns: RankedColumn<TreeNode>[] = [
    { key: "rank", header: "#", className: "w-10", cell: (_r, i) => <Rank index={i} /> },
    {
      key: "name",
      header: levelColumnHeading(level),
      cell: (row) => <NodeNameButton node={row} onOpen={onOpen} />,
    },
    ...tallyColumns<TreeNode>(anyPending(rows)),
    leaf
      ? {
          key: "papers",
          header: "Papers",
          align: "right" as const,
          cell: (row) => (
            <span title="Countable midterms this class sat in this month. Pre-midterms and retake papers are not counted separately.">
              <Num value={row.midterms ?? 0} />
            </span>
          ),
        }
      : {
          key: "children",
          header: kidLevel ? levelHeading(kidLevel) : "Inside",
          align: "right" as const,
          cell: (row) => (
            <span title={`Open this row to see its ${childCountLabel(row)}.`}>
              <Num value={children(row).length} />
            </span>
          ),
        },
  ];

  return (
    <RankedTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      minWidthClass="min-w-[900px]"
      empty={
        <EmptyPanel
          title={`No ${LEVEL_NOUN[level].many} to show here`}
          body="Nothing under this row sat a countable paper in this month. Step back up with the trail above, or pick another month."
        />
      }
    />
  );
}

/**
 * The whole drill-down: breadcrumb, the current level's table, and the notes that belong to it.
 *
 * Presentational — the path lives on the page, because switching month has to reset it and
 * opening a class has to leave it standing.
 */
export function HierarchyPanel({
  roots,
  path,
  derived,
  month,
  onGo,
  onOpen,
}: {
  roots: TreeNode[];
  path: TreeNode[];
  /** The payload carried no hierarchy and this one was rebuilt in the browser. Say so. */
  derived: boolean;
  month: MonthKey | null;
  onGo: (depth: number) => void;
  onOpen: (node: TreeNode) => void;
}) {
  const { parent, rows, level, kidLevel } = viewAt(roots, path);
  const rootLabel = `All ${LEVEL_NOUN[roots[0]?.level ?? "region"].many}`;

  return (
    <div className="space-y-3">
      <HierarchyBreadcrumb path={path} rootLabel={rootLabel} onGo={onGo} />

      <SectionCard
        index={6}
        title={scopeHeading(level, parent)}
        description={
          <>
            {parent
              ? `Inside ${parent.name} only — ${plural(parent.classrooms, "class", "classes")}, pooled.`
              : `Every ${LEVEL_NOUN[level].one} in ${monthLabel(month) || "this month"}, pooled.`}{" "}
            {level === "classroom"
              ? "Open a class for its papers, and the students behind them."
              : kidLevel
                ? `Open a row to see the ${LEVEL_NOUN[kidLevel].many} inside it.`
                : ""}
          </>
        }
        actions={parent ? <ScopeFigure node={parent} /> : null}
      >
        <HierarchyTable rows={rows} level={level} kidLevel={kidLevel} onOpen={onOpen} />
        <DenominatorNote rows={rows} />
        {derived ? (
          <div className="border-t border-border px-5 py-3">
            <p
              role="status"
              className={cn(
                "rounded-xl border border-warning/25 bg-warning-soft px-3 py-2",
                "text-[13px] text-warning-foreground",
              )}
            >
              <strong className="font-bold">This hierarchy was rebuilt in the browser.</strong>{" "}
              The server sent no tree with this month, so the levels above were grouped from the
              class list here. Every count is exact except the student headcount, which is left
              off the rows it cannot be known for — a student in two classes would be counted
              twice.
            </p>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
