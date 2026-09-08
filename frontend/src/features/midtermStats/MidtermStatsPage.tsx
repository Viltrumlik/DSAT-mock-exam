"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, CalendarClock, FolderOpen, RefreshCw } from "lucide-react";
import { Select, Tabs } from "@/components/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import MidtermRecordsBrowser from "@/features/midtermReports/MidtermReportsPage";
import { ClassroomMonthPanel } from "./ClassroomMonthPanel";
import { DefinitionNote } from "./DefinitionNote";
import { HeadlineStats } from "./HeadlineStats";
import { PassRateChart } from "./PassRateChart";
import { BranchTable, ClassroomTable, DepartmentTable, TeacherTable } from "./RankTables";
import { EmptyPanel, ErrorPanel, Note, SectionCard, TableSkeleton } from "./StatsUI";
import { errText, midtermStatsApi } from "./api";
import { monthLabel, plural } from "./format";
import type { ClassroomRow, MonthKey, MonthlyStats } from "./types";

/**
 * The admin console's midterm page: one month of the school, ranked, with the names one click
 * away.
 *
 * The page this replaces answered only "what did each student score", one classroom and one
 * paper at a time — nothing about a class as a whole was ever shown, so the questions the
 * school actually asks ("how did this branch do", "how is this teacher's month", "how many got
 * through without a retake") could not be answered here at all. The order is deliberate:
 * statistics first, detail on request.
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

export default function MidtermStatsPage() {
  const [tab, setTab] = useState<TabKey>("statistics");
  /** null until the first response: the backend opens on the newest month that has data. */
  const [month, setMonth] = useState<MonthKey | null>(null);
  const [stats, setStats] = useState<MonthlyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ClassroomRow | null>(null);

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

  const months = stats?.months ?? [];
  /** What the picker shows: the month asked for, so it does not snap back mid-request. */
  const pickerMonth = month ?? stats?.month ?? "";
  /** What the prose describes: the month the data on screen is actually for. */
  const shownMonth = stats?.month ?? month;
  const empty = stats != null && stats.totals.midterms === 0;

  const monthPicker =
    months.length > 0 ? (
      <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
        <CalendarClock className="h-4 w-4" aria-hidden />
        <span className="sr-only sm:not-sr-only">Month</span>
        <span className="w-44">
          <Select
            selectSize="sm"
            value={pickerMonth}
            onChange={(e) => {
              setSelected(null);
              setMonth(e.target.value || null);
            }}
            aria-label="Statistics month"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
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
        description="How every branch, department, teacher and class did in one month — and the students behind each number."
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
          <HeadlineStats stats={stats} />
          <DefinitionNote definition={stats.definition} />

          {stats.totals.pending > 0 && (
            <Note>
              {plural(stats.totals.pending, "student")} in {monthLabel(shownMonth)} are still
              awaiting a result. They are in the denominator and not in the numerator, so every
              rate on this page is a floor for this month — it can only go up as those verdicts
              land.
            </Note>
          )}

          {empty ? (
            <SectionCard>
              <div className="p-5">
                <EmptyPanel
                  title={`No midterms in ${monthLabel(shownMonth) || "this month"}`}
                  body="No class sat a countable paper in this month. Pick another month above — a paper falls in the month it was timetabled for, or, when it was never timetabled, the month somebody first sat it."
                />
              </div>
            </SectionCard>
          ) : (
            <>
              <PassRateChart stats={stats} />

              <SectionCard
                title="Branches"
                description="Each branch's passers over its classrooms' rosters. Classrooms with no branch set get their own row rather than being dropped."
              >
                <BranchTable rows={stats.branches} />
              </SectionCard>

              <SectionCard
                title="Departments"
                description="English and Math, pooled the same way. A department is the classroom's subject — there is no separate department record."
              >
                <DepartmentTable rows={stats.departments} />
              </SectionCard>

              <SectionCard
                title="Teachers"
                description="Each teacher over their own classes. A class with nobody assigned is shown as its own row, because its students still count in the school total."
              >
                <TeacherTable rows={stats.teachers} />
              </SectionCard>

              <SectionCard
                title="Classes"
                description="Every class that sat a countable paper this month. Open one for its papers, and the students behind them."
              >
                <ClassroomTable rows={stats.classrooms} onSelect={setSelected} />
              </SectionCard>
            </>
          )}
        </div>
      )}
    </div>
  );
}
