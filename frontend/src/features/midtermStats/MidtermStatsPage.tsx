"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarClock, FolderOpen, RefreshCw } from "lucide-react";
import { Select, Tabs } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import MidtermRecordsBrowser from "@/features/midtermReports/MidtermReportsPage";
import { ClassroomMonthPanel } from "./ClassroomMonthPanel";
import { DefinitionNote } from "./DefinitionNote";
import { HeadlineStats } from "./HeadlineStats";
import { HierarchyPanel } from "./HierarchyPanel";
import { PassRateChart } from "./PassRateChart";
import { ScheduledClassroomTable } from "./RankTables";
import {
  EmptyPanel,
  ErrorPanel,
  Note,
  OrphanRetakeNote,
  ScheduledBanner,
  SectionCard,
  TableSkeleton,
} from "./StatsUI";
import { errText, midtermStatsApi } from "./api";
import { latestSatMonth, monthLabel, monthOptionLabel, plural, titleList } from "./format";
import { collapseFrom, hierarchyFor, resolvePath, viewAt } from "./tree";
import type { MonthKey, MonthlyStats, TreeNode } from "./types";

/**
 * The admin console's midterm page: one month of the school, one level at a time, with the
 * names a few clicks away.
 *
 * Two rebuilds are visible here. The page this first replaced answered only "what did each
 * student score", one classroom and one paper at a time — nothing about a class as a whole was
 * ever shown. The page THAT became answered the pooled questions but drew four flat sibling
 * tables at once — Branches, Departments, Teachers, Classes — with no relationship between
 * them, which is the complexity the owner asked us to remove: *"hierarchy qiling"*. The four
 * are now one drill-down, `region → branch → department → teacher → class`, and the class row
 * still opens the same per-student panel it always did.
 *
 * The order is deliberate: the whole school in five tiles, the rule those tiles were computed
 * by, then the level the reader is standing in, then detail on request.
 *
 * **Data fetching is plain `useState` + axios, not React Query, and that is not an oversight.**
 * The in-app browser pane reports `visibilityState: "hidden"`, which pauses React Query's
 * retries indefinitely — a failed fetch never resolves and the page spins forever. Every ops
 * surface fetches this way.
 */

type TabKey = "statistics" | "records";

const TABS = [
  { value: "statistics", label: "Statistics", icon: BarChart3 },
  { value: "records", label: "Classroom records", icon: FolderOpen },
];

/** All the drill-down panel needs of a class to open it: an id and something to call it. */
type OpenClass = { id: number; name: string };

export default function MidtermStatsPage() {
  const [tab, setTab] = useState<TabKey>("statistics");
  /** null until the first response: the backend opens on the newest month that has data. */
  const [month, setMonth] = useState<MonthKey | null>(null);
  const [stats, setStats] = useState<MonthlyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OpenClass | null>(null);
  /**
   * Where the reader has drilled to, as node KEYS rather than nodes.
   *
   * Keys, because a refresh replaces every node object while the position on screen should
   * survive it. `null` means "wherever the payload says to open" — which is not the top level:
   * a level with one child is passed through, so today the page opens on Departments.
   */
  const [pathKeys, setPathKeys] = useState<string[] | null>(null);

  const load = useCallback(async (requested: MonthKey | null) => {
    setLoading(true);
    setError(null);
    try {
      setStats(await midtermStatsApi.monthly(requested));
    } catch (e) {
      // Never fall back to an empty payload: a failed request that renders as "no midterms
      // this month" is a lie about the school, and this page is read to judge people.
      setStats(null);
      setError(errText(e, "Could not load the monthly statistics."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  /** Switching month replaces the whole tree, so the reader's position in it goes with it. */
  const openMonth = useCallback((next: MonthKey | null) => {
    setSelected(null);
    setPathKeys(null);
    setMonth(next);
  }, []);

  const months = stats?.months ?? [];
  /** What the picker shows: the month asked for, so it does not snap back mid-request. */
  const pickerMonth = month ?? stats?.month ?? "";
  /** What the prose describes: the month the data on screen is actually for. */
  const shownMonth = stats?.month ?? month;
  const empty = stats != null && stats.totals.midterms === 0;
  /** Months this scope has not reached. Empty-defaulted: an older backend sends no key. */
  const futureMonths = stats?.future_months ?? [];
  /** The selected month is a plan, not a result — see `ScheduledBanner`. */
  const scheduled = stats?.is_future === true;
  const orphans = stats?.orphan_retakes ?? [];
  /**
   * `month: null` with months still to come is the payload's way of saying there is no default
   * to open on — `/stats/months/` says the same thing as `current: null`. It is NOT an empty
   * school and must not render as one: everything this scope has is still ahead of it.
   */
  const noResultsYet = stats != null && stats.month == null && futureMonths.length > 0;

  const hierarchy = useMemo(() => hierarchyFor(stats), [stats]);
  /**
   * A stored path can go stale — a refresh that lands a different month, a class that stopped
   * counting — and `resolvePath` answers that with the deepest position that still exists
   * rather than with a blank table.
   */
  const path = useMemo(
    () => (pathKeys == null ? hierarchy.openPath : resolvePath(hierarchy.roots, pathKeys)),
    [hierarchy, pathKeys],
  );
  const view = useMemo(() => viewAt(hierarchy.roots, path), [hierarchy.roots, path]);

  /** Going UP is literal: the reader asked for that level, even if it holds one row. */
  const goTo = useCallback(
    (depth: number) => setPathKeys(path.slice(0, depth).map((n) => n.key)),
    [path],
  );

  /** Going DOWN collapses: a level with a single child is passed through, never clicked through. */
  const open = useCallback(
    (node: TreeNode) => {
      if (node.level === "classroom") {
        setSelected({ id: node.id as number, name: node.name });
        return;
      }
      setPathKeys(collapseFrom(hierarchy.roots, [...path, node]).map((n) => n.key));
    },
    [hierarchy.roots, path],
  );

  const monthPicker =
    months.length > 0 ? (
      <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
        <CalendarClock className="h-4 w-4" aria-hidden />
        <span className="sr-only sm:not-sr-only">Month</span>
        {/* Wide enough for "October 2026 (scheduled)" to be read WHILE CLOSED. At w-44 the
            marker was clipped to "October 2026 (sch", which is the one word that had to
            survive. */}
        <span className="w-60">
          <Select
            selectSize="sm"
            value={pickerMonth}
            onChange={(e) => openMonth(e.target.value || null)}
            aria-label="Statistics month"
          >
            {/* With no month to open on there is nothing to select, and a control whose value
                matches no option renders blank — which reads as a broken picker rather than as
                the honest answer it is. */}
            {pickerMonth ? null : <option value="">No month with results</option>}
            {/* A month nobody has sat says so in the option itself. It sorts first, right
                under the cursor, and picking one must be a choice rather than a discovery. */}
            {months.map((m) => (
              <option key={m} value={m}>
                {monthOptionLabel(m, futureMonths)}
              </option>
            ))}
          </Select>
        </span>
      </label>
    ) : null;

  return (
    <div className="space-y-5">
      <OpsPageHeader
        section="Midterms"
        title="Midterm statistics"
        description="One month, opened one level at a time: regions, then branches, departments, teachers and classes — and the students behind each number."
        actions={
          tab === "statistics" && selected == null ? (
            <>
              {monthPicker}
              <button
                type="button"
                onClick={() => void load(month)}
                className="ds-ring inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground transition-colors hover:bg-surface-2"
              >
                <RefreshCw className="h-4 w-4" aria-hidden />
                Refresh
              </button>
            </>
          ) : null
        }
      />

      <Tabs
        tabs={TABS}
        value={tab}
        onValueChange={(v) => setTab(v as TabKey)}
        aria-label="Midterm views"
      />

      {tab === "records" ? (
        <MidtermRecordsBrowser />
      ) : selected != null ? (
        <ClassroomMonthPanel
          classroomId={selected.id}
          initialMonth={shownMonth}
          fallbackName={selected.name}
          onBack={() => setSelected(null)}
          backLabel={`Back to ${monthLabel(shownMonth) || "the"} statistics`}
        />
      ) : error ? (
        <ErrorPanel message={error} onRetry={() => void load(month)} />
      ) : loading || stats == null ? (
        <div className="space-y-4" aria-busy>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-2" />
            ))}
          </div>
          <SectionCard>
            <TableSkeleton rows={6} />
          </SectionCard>
        </div>
      ) : (
        <div className="space-y-4">
          {/* First on the page, before any figure: the reader has to know what they are
              looking at before they look at it. */}
          {scheduled && shownMonth ? (
            <ScheduledBanner
              month={shownMonth}
              thisMonth={stats.this_month}
              latestMonth={latestSatMonth(months, futureMonths)}
              onOpenLatest={() => openMonth(latestSatMonth(months, futureMonths))}
              detail={`${plural(stats.totals.midterms, "paper")} timetabled for ${plural(stats.totals.classrooms, "class", "classes")}, and ${plural(stats.totals.distinct_students, "student")} on those rosters.`}
            />
          ) : null}

          {/* No month was selected at all, so there is nothing for a row of tiles to be ABOUT.
              Their zeros would be a description of an empty selection wearing the words
              "Passed" and "Did not pass". An empty month that genuinely happened still gets
              them: its zeros describe a month.

              These tiles are the WHOLE SCHOOL wherever the reader has drilled to. They do not
              follow the drill-down on purpose — a reader looking at one department needs the
              total to compare it against — which is why the card below states whose numbers
              its own table is showing. */}
          {noResultsYet ? null : <HeadlineStats stats={stats} />}
          <DefinitionNote definition={stats.definition} />

          {/* Excluded from every number above, and named. Rendered whether or not the month
              has data: a month whose only paper is an orphan is exactly the one whose
              emptiness needs explaining. */}
          <OrphanRetakeNote month={shownMonth ?? null} papers={orphans} />

          {/* `pending` counts roster places — (student, paper) pairs — not students, so a
              student awaiting two verdicts is two of them. Naming them "students" here made
              the same mistake the Students tile used to make, one altitude down. */}
          {!scheduled && stats.totals.pending > 0 && (
            <Note>
              {plural(stats.totals.pending, "roster place")} in {monthLabel(shownMonth)}{" "}
              {stats.totals.pending === 1 ? "is" : "are"} still awaiting a result. They are in
              the denominator and not in the numerator, so every rate on this page is a floor
              for this month — it can only go up as those verdicts land.
            </Note>
          )}

          {scheduled ? (
            /* No drill-down and no ranking. Every level of a hierarchy is a comparison, and
               ordering classes "best first" over a month nobody has sat would be read as a
               finding about the classes at the bottom. */
            <SectionCard
              title={`Booked for ${monthLabel(shownMonth) || "this month"}`}
              description="What is timetabled, not how it went. Open a class to see which papers it has coming."
            >
              <ScheduledClassroomTable rows={stats.classrooms} onSelect={setSelected} />
            </SectionCard>
          ) : noResultsYet ? (
            <SectionCard>
              <div className="p-5">
                <EmptyPanel
                  title="No results yet"
                  body={`Nothing has been sat under this view. Every month it has is still ahead: ${titleList(futureMonths.map(monthLabel))}. Pick one above — marked "scheduled" — to see what is booked, or widen the view.`}
                />
              </div>
            </SectionCard>
          ) : empty ? (
            <SectionCard>
              <div className="p-5">
                {orphans.length > 0 ? (
                  /* The month is not empty — it is empty OF THINGS THAT COUNT, and the reason
                     is sitting in the builder under a name the reader can search for. */
                  <EmptyPanel
                    title={`No countable midterms in ${monthLabel(shownMonth) || "this month"}`}
                    body={`The only ${orphans.length === 1 ? "paper" : plural(orphans.length, "paper")} dating into this month ${orphans.length === 1 ? "is a retake" : "are retakes"} with no parent midterm — ${titleList(orphans.map((p) => p.title))} — and a parentless retake is counted nowhere. Nothing else was timetabled here.`}
                  />
                ) : (
                  <EmptyPanel
                    title={`No midterms in ${monthLabel(shownMonth) || "this month"}`}
                    body="No class sat a countable paper in this month. Pick another month above — a paper falls in the month it was timetabled for, or, when it was never timetabled, the month somebody first sat it."
                  />
                )}
              </div>
            </SectionCard>
          ) : (
            <>
              {/* The chart plots the rows the table below lists, never a level the reader is
                  not on. It draws nothing until a level actually branches. */}
              <PassRateChart
                nodes={view.rows}
                level={view.level}
                month={shownMonth}
                scope={view.parent?.name ?? null}
              />

              <HierarchyPanel
                roots={hierarchy.roots}
                path={path}
                derived={hierarchy.derived}
                month={shownMonth}
                onGo={goTo}
                onOpen={open}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
