"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarClock, Download, FolderOpen, RefreshCw } from "lucide-react";
import { Select, Tabs } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import MidtermRecordsBrowser from "@/features/midtermReports/MidtermReportsPage";
import { cn } from "@/lib/cn";
import { ClassroomMonthPanel } from "./ClassroomMonthPanel";
import { DefinitionNote } from "./DefinitionNote";
import { SummaryCards } from "./SummaryCards";
import { HierarchyPanel } from "./HierarchyPanel";
import { LevelBars, ResultsDonut, TrendChart } from "./StatsCharts";
import { SplitLegend } from "./SplitBar";
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
import type { MonthKey, MonthlyStats, TreeNode, TrendPoint } from "./types";

/**
 * The admin console's midterm page: one month of the school, told in the order a person asks
 * about it — how did we do, what happened, who needs looking at.
 *
 * Three rebuilds are visible here, and the third is why the page looks like this. The first
 * page answered only "what did each student score", one class and one paper at a time. The
 * second answered the pooled questions but drew four flat sibling tables at once. The third
 * turned those into a drill-down — and the owner's verdict on the result was that it had
 * become *chalkash va murakkab*: tangled and complicated. Every figure was correct, and the
 * page spent its first screen on three blocks of explanation before it showed a single one.
 *
 * So the order is now: the four numbers, the pictures that make them mean something, the
 * level you are standing in, and the rules underneath where a reader who wants them can
 * find them. Nothing was removed — the definition, the outstanding-results warning and the
 * orphaned-retake disclosure are all still here, at the foot of the page instead of ahead
 * of the data. And the reporting dialect is gone: no roster places, no denominators, no
 * verdicts. Passed, failed, did not come, waiting for a result.
 *
 * **Data fetching is plain `useState` + axios, not React Query, and that is not an
 * oversight.** The in-app browser pane reports `visibilityState: "hidden"`, which pauses
 * React Query's retries indefinitely — a failed fetch never resolves and the page spins
 * forever. Every ops surface fetches this way.
 */

type TabKey = "statistics" | "records";

const TABS = [
  { value: "statistics", label: "Results", icon: BarChart3 },
  { value: "records", label: "Class records", icon: FolderOpen },
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
  /** The month-by-month line, fetched beside the month because it costs far more to build. */
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
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
      setError(errText(e, "Could not load this month's results."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  /** The trend does not depend on the selected month, so it is fetched once. */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const points = await midtermStatsApi.trend();
        if (alive) setTrend(points);
      } catch (e) {
        if (alive) setTrendError(errText(e, "Could not load the earlier months."));
      } finally {
        if (alive) setTrendLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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

  /**
   * What the download button will produce: the branch the reader is standing in, or the
   * whole school. An Unassigned branch has no id to ask for, and the school-wide document
   * contains its classes anyway — so it falls back rather than offering a broken download.
   */
  const branchNode = path.find((n) => n.level === "branch" && n.id != null) ?? null;
  const pdfLabel = branchNode ? branchNode.name : "All branches";

  const downloadPdf = useCallback(async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      await midtermStatsApi.downloadBranchPdf(branchNode?.id ?? 0, shownMonth ?? null, pdfLabel);
    } catch (e) {
      setPdfError(errText(e, "Could not build the PDF."));
    } finally {
      setPdfBusy(false);
    }
  }, [branchNode, pdfLabel, shownMonth]);

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
        <span className="w-[min(15rem,60vw)] sm:w-60">
          <Select
            selectSize="sm"
            value={pickerMonth}
            onChange={(e) => openMonth(e.target.value || null)}
            aria-label="Month"
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
        title="Midterm results"
        description="How every class did this month — open a row to go from the whole learning center down to one student."
        actions={
          tab === "statistics" && selected == null ? (
            <>
              {monthPicker}
              {/* One file for everything under this heading: departments, their teachers,
                  every class and every student. It used to take one download per class. */}
              <button
                type="button"
                onClick={() => void downloadPdf()}
                disabled={pdfBusy}
                title={`Download ${pdfLabel} for ${monthLabel(shownMonth) || "this month"} as one PDF — every department, teacher, class and student.`}
                className="ds-ring inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                <Download className={cn("h-4 w-4", pdfBusy && "animate-pulse")} aria-hidden />
                {pdfBusy ? "Preparing…" : "Download PDF"}
              </button>
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
          backLabel={`Back to ${monthLabel(shownMonth) || "the"} results`}
        />
      ) : error ? (
        <ErrorPanel message={error} onRetry={() => void load(month)} />
      ) : loading || stats == null ? (
        <div className="space-y-4" aria-busy>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-surface-2" />
            ))}
          </div>
          <SectionCard>
            <TableSkeleton rows={6} />
          </SectionCard>
        </div>
      ) : (
        <div className="space-y-4">
          {pdfError ? (
            <Note className="border-danger/25 bg-danger-soft text-danger-foreground">{pdfError}</Note>
          ) : null}

          {/* Before any figure: the reader has to know what they are looking at. */}
          {scheduled && shownMonth ? (
            <ScheduledBanner
              month={shownMonth}
              thisMonth={stats.this_month}
              latestMonth={latestSatMonth(months, futureMonths)}
              onOpenLatest={() => openMonth(latestSatMonth(months, futureMonths))}
              detail={`${plural(stats.totals.midterms, "exam")} booked for ${plural(stats.totals.classrooms, "class", "classes")}, and ${plural(stats.totals.distinct_students, "student")} due to sit them.`}
            />
          ) : null}

          {/* No month was selected at all, so there is nothing for a row of cards to be ABOUT.
              Their zeros would be a description of an empty selection wearing the words
              "Passed" and "Did not pass". An empty month that genuinely happened still gets
              them: its zeros describe a month.

              These cards are the WHOLE SCHOOL wherever the reader has drilled to. They do not
              follow the drill-down on purpose — a reader looking at one department needs the
              total to compare it against — which is why the card below states whose numbers
              its own table is showing. */}
          {noResultsYet ? null : <SummaryCards stats={stats} />}

          {scheduled ? (
            /* No drill-down and no ranking. Every level of a hierarchy is a comparison, and
               ordering classes "best first" over a month nobody has sat would be read as a
               finding about the classes at the bottom. */
            <SectionCard
              title={`Booked for ${monthLabel(shownMonth) || "this month"}`}
              description="What is timetabled, not how it went. Open a class to see which exams it has coming."
            >
              <ScheduledClassroomTable rows={stats.classrooms} onSelect={setSelected} />
            </SectionCard>
          ) : noResultsYet ? (
            <SectionCard>
              <div className="p-5">
                <EmptyPanel
                  title="No results yet"
                  body={`Nobody has sat an exam under this view. Every month it has is still ahead: ${titleList(futureMonths.map(monthLabel))}. Pick one above — marked "scheduled" — to see what is booked.`}
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
                    title={`No exams counted in ${monthLabel(shownMonth) || "this month"}`}
                    body={`The only ${orphans.length === 1 ? "paper" : plural(orphans.length, "paper")} dating into this month ${orphans.length === 1 ? "is a retake" : "are retakes"} with no parent exam — ${titleList(orphans.map((p) => p.title))} — and a retake with no parent is counted nowhere. Nothing else was booked here.`}
                  />
                ) : (
                  <EmptyPanel
                    title={`No exams in ${monthLabel(shownMonth) || "this month"}`}
                    body="No class sat an exam that counts in this month. Pick another month above — an exam falls in the month it was booked for, or, when it was never booked, the month somebody first sat it."
                  />
                )}
              </div>
            </SectionCard>
          ) : (
            <>
              {/* `cr-rise` rather than `cr-card`: this is a grid of two cards, and a hover
                  lift belongs to each card, not to the pair of them. */}
              <div className="cr-rise grid gap-4 lg:grid-cols-2" style={{ animationDelay: "300ms" }}>
                <ResultsDonut stats={stats} />
                {/* Draws nothing until a level actually branches; the grid then gives the
                    donut the full width rather than leaving a hole beside it. */}
                <LevelBars
                  nodes={view.rows}
                  level={view.level}
                  month={shownMonth}
                  scope={view.parent?.name ?? null}
                />
              </div>

              <div className="cr-rise" style={{ animationDelay: "380ms" }}>
                <TrendChart points={trend} loading={trendLoading} error={trendError} />
              </div>

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

          {/* Everything a reader may need and nobody needs FIRST. This is the block that used
              to sit between the numbers and the table. */}
          <div className="space-y-3 border-t border-border pt-4">
            <SplitLegend />
            {!scheduled && stats.totals.pending > 0 && (
              <Note>
                {plural(stats.totals.pending, "result")} in {monthLabel(shownMonth)}{" "}
                {stats.totals.pending === 1 ? "is" : "are"} still to come. They count as not
                passed for now, so every rate here can only go up.
              </Note>
            )}
            <OrphanRetakeNote month={shownMonth ?? null} papers={orphans} />
            <DefinitionNote definition={stats.definition} />
          </div>
        </div>
      )}
    </div>
  );
}
