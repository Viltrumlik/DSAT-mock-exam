"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { examsStudentApi } from "@/features/examsStudent/api";
import { ArrowRight, Clock, FileText, Search, Target, Trophy, X } from "lucide-react";
import { useMe } from "@/hooks/useMe";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";

type ExamKindFilter = "ALL" | "MOCK_SAT" | "MIDTERM";

type MockExamsListProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  mockQuerySuffix?: string;
  examKindFilter?: ExamKindFilter;
};

const examsPublicApi = examsStudentApi;

function routeMockId(group: any) {
  return group.mock_exam_id ?? group.id;
}

function sectionTestIds(group: any): number[] {
  if (Array.isArray(group.section_test_ids)) return group.section_test_ids;
  const tests = group.tests || [];
  return tests.map((t: any) => t.id).filter(Boolean);
}

export default function MockExamsList({
  eyebrow = "Student portal",
  title,
  description,
  mockQuerySuffix = "",
  examKindFilter = "ALL",
}: MockExamsListProps) {
  const [mockExams, setMockExams] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<string>("");
  const router = useRouter();
  const { isAuthenticated } = useMe();
  const isLoggedIn = isAuthenticated;

  useEffect(() => {
    const fetchData = async () => {
      try {
        const mockBundle = await examsPublicApi.getMockExams();
        setMockExams(mockBundle.items);
        if (isLoggedIn) {
          const attemptsBundle = await examsPublicApi.getAttempts();
          setAttempts(attemptsBundle.items);
        }
      } catch (err) {
        console.error(err);
      }
    };
    void fetchData();
  }, [isLoggedIn]);

  const getAvailableDates = () => {
    const dates = new Set<string>();
    mockExams.forEach((exam: any) => {
      if (exam.practice_date) dates.add(exam.practice_date.substring(0, 7));
    });
    return Array.from(dates).sort().reverse();
  };

  const formatDateLabel = (yearMonth: string) => {
    const [year, month] = yearMonth.split("-");
    return new Date(parseInt(year, 10), parseInt(month, 10) - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  const groupedExams = useMemo(() => {
    if (examKindFilter === "ALL") return mockExams;
    return (mockExams || []).filter((g: any) => {
      if (examKindFilter === "MOCK_SAT") return g.kind !== "MIDTERM";
      if (examKindFilter === "MIDTERM") return g.kind === "MIDTERM";
      return true;
    });
  }, [mockExams, examKindFilter]);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "No Date";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
    } catch {
      return dateStr;
    }
  };

  const progressForGroup = (group: any) => {
    const ids = sectionTestIds(group);
    if (ids.length === 0) return 0;
    const done = ids.filter((tid) =>
      attempts.some((a) => a.practice_test === tid && a.is_completed)
    ).length;
    return Math.round((done / ids.length) * 100);
  };

  const filtered = groupedExams
    .filter((group: any) =>
      (group.title || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (group.practice_date && group.practice_date.includes(searchQuery))
    )
    .filter((group: any) =>
      !dateFilter || (group.practice_date && group.practice_date.startsWith(dateFilter))
    );

  /* ── Computed stats ─────────────────────────────────────────────────── */
  const totalMocks = groupedExams.length;
  const completedMocks = groupedExams.filter((g) => progressForGroup(g) === 100).length;
  const inProgressMocks = groupedExams.filter((g) => { const p = progressForGroup(g); return p > 0 && p < 100; }).length;
  const avgProgress = totalMocks > 0 ? Math.round(groupedExams.reduce((s, g) => s + progressForGroup(g), 0) / totalMocks) : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:px-6">

      {/* ═══ Header ══════════════════════════════════════════════════════ */}
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
      />

      {/* ═══ Stats Row ═══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-4">
        <StatCard
          label="Total Mocks"
          value={totalMocks}
          icon={FileText}
          accent="text-primary bg-primary/10"
        />
        <StatCard
          label="Completed"
          value={completedMocks}
          icon={Trophy}
          accent="text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40"
        />
        <StatCard
          label="In Progress"
          value={inProgressMocks}
          icon={Clock}
          accent="text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40"
        />
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 flex items-center gap-4">
          <ProgressRing
            value={avgProgress}
            size={48}
            strokeWidth={5}
            color={avgProgress >= 80 ? "text-emerald-500" : "text-primary"}
          />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Avg Progress</p>
            <p className="text-xl font-black tabular-nums text-foreground">{avgProgress}%</p>
          </div>
        </div>
      </div>

      {/* ═══ Filters ═════════════════════════════════════════════════════ */}
      <div className="mb-8 flex flex-col items-center justify-between gap-4 md:flex-row">
        <div className="flex w-full items-center gap-2 md:w-auto">
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium shadow-sm outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
          >
            <option value="">All dates</option>
            {getAvailableDates().map((dateStr) => (
              <option key={dateStr} value={dateStr}>{formatDateLabel(dateStr)}</option>
            ))}
          </select>
          {dateFilter && (
            <button type="button" onClick={() => setDateFilter("")} className="rounded-xl border border-border bg-card p-2.5 text-muted-foreground hover:text-foreground transition-colors" aria-label="Clear date filter">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="group relative w-full md:w-80">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
          <input
            type="text"
            placeholder="Search mock exams..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-11 pr-10 text-sm font-medium shadow-sm outline-none transition-all focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ═══ Cards Grid ══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((group: any) => {
          const pct = progressForGroup(group);
          const mid = routeMockId(group);
          const completed = pct === 100;
          return (
            <div
              key={group.id ?? mid}
              className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/25 hover:shadow-md"
            >
              <div className="p-5 pb-3">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-widest",
                      group.kind === "MIDTERM" ? "text-amber-600 dark:text-amber-400" : "text-primary",
                    )}>
                      {group.kind === "MIDTERM" ? "Midterm" : "Timed SAT Mock"}
                    </span>
                    <p className="text-xs font-semibold text-muted-foreground mt-0.5">{formatDate(group.practice_date)}</p>
                  </div>
                  <ProgressRing
                    value={pct}
                    size={40}
                    strokeWidth={3}
                    color={completed ? "text-emerald-500" : "text-primary"}
                  >
                    <span className="text-[9px] font-black tabular-nums text-foreground">{pct}%</span>
                  </ProgressRing>
                </div>

                <h3 className="text-lg font-extrabold leading-snug tracking-tight text-foreground group-hover:text-primary transition-colors">
                  {group.title}
                </h3>

                {completed && (
                  <span className="mt-2 inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                    <Trophy className="h-3 w-3" />
                    Completed
                  </span>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-700",
                        completed ? "bg-emerald-500" : "bg-primary",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-auto p-5 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!isLoggedIn) { router.push("/login"); return; }
                    router.push(`/mock/${mid}${mockQuerySuffix}`);
                  }}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-colors active:scale-[0.98]",
                    completed
                      ? "border border-border bg-card text-foreground hover:bg-surface-2"
                      : "bg-primary text-primary-foreground hover:bg-primary/90",
                  )}
                >
                  {completed ? "Review" : "Enter Timed Mock"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}

        {groupedExams.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={Target}
              title="No mock exams yet"
              description="Mock exams will appear here when your admin publishes them. Practice with past papers first to build up your skills."
            />
          </div>
        )}
        {groupedExams.length > 0 && filtered.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={Search}
              title="No matching exams"
              description="Try adjusting your search or date filter."
              action={
                <button
                  type="button"
                  onClick={() => { setSearchQuery(""); setDateFilter(""); }}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
                >
                  Clear filters
                </button>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
