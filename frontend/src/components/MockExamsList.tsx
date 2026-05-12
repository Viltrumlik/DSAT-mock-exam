"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { examsStudentApi } from "@/features/examsStudent/api";
import { FileText, Search, X, ArrowRight } from "lucide-react";
import { useMe } from "@/hooks/useMe";
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
    const isLogged = isLoggedIn;

    const fetchData = async () => {
      try {
        const mockBundle = await examsPublicApi.getMockExams();
        setMockExams(mockBundle.items);
        if (isLogged) {
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
      if (exam.practice_date) {
        const monthYear = exam.practice_date.substring(0, 7);
        dates.add(monthYear);
      }
    });
    return Array.from(dates).sort().reverse();
  };

  const formatDateLabel = (yearMonth: string) => {
    const [year, month] = yearMonth.split("-");
    const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1);
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
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
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
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
    .filter(
      (group: any) =>
        (group.title || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (group.practice_date && group.practice_date.includes(searchQuery))
    )
    .filter(
      (group: any) => !dateFilter || (group.practice_date && group.practice_date.startsWith(dateFilter))
    );

  const cardShell =
    "ui-card group flex flex-col overflow-hidden rounded-[32px] hover:-translate-y-1";

  return (
    <div className="mx-auto max-w-7xl px-8 py-12">
      <div className="mb-12">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-1 w-12 rounded-full bg-primary" />
          <span className="block text-[10px] font-bold uppercase tracking-widest text-primary">{eyebrow}</span>
        </div>
        <h2 className="mb-4 text-4xl font-extrabold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="max-w-2xl text-lg font-medium leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>

      <div className="mb-10 flex flex-col items-center justify-between gap-6 md:flex-row">
        <div className="group relative flex w-full items-center gap-2 md:w-auto">
          <div className="relative flex-1 md:w-64">
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="ui-input w-full cursor-pointer appearance-none rounded-[18px] px-4 py-3 text-sm font-medium shadow-sm"
            >
              <option value="">All Available Dates</option>
              {getAvailableDates().map((dateStr) => (
                <option key={dateStr} value={dateStr}>
                  {formatDateLabel(dateStr)}
                </option>
              ))}
            </select>
          </div>
          {dateFilter ? (
            <button
              type="button"
              onClick={() => setDateFilter("")}
              className="rounded-[14px] border border-border bg-card p-3 text-label-foreground shadow-sm hover:text-foreground"
              aria-label="Clear date filter"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <div className="group relative w-full md:w-96">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-label-foreground group-focus-within:text-primary" />
          <input
            type="text"
            placeholder="Search mock exams..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ui-input w-full rounded-[18px] py-3 pl-11 pr-10 text-sm font-medium shadow-sm"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-label-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((group: any) => {
          const pct = progressForGroup(group);
          const mid = routeMockId(group);
          return (
            <div key={group.id ?? mid} className={cardShell}>
              <div className="relative p-8 pb-4">
                <div className="mb-6 flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">
                      {group.kind === "MIDTERM" ? "Midterm" : "Timed SAT mock"}
                    </span>
                    <span className="text-xs font-bold text-label-foreground">{formatDate(group.practice_date)}</span>
                  </div>
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm transition-all duration-300 group-hover:bg-primary group-hover:text-white">
                    <FileText className="h-6 w-6" />
                  </div>
                </div>
                <h3 className="mb-3 font-serif text-2xl font-bold tracking-tight text-foreground transition-colors group-hover:text-primary">
                  {group.title}
                </h3>
                <div className="mb-6 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full bg-primary transition-all duration-1000" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-label-foreground">{pct}%</span>
                </div>
              </div>
              <div className="mt-auto p-6 pt-0">
                <button
                  type="button"
                  onClick={() => {
                    if (!isLoggedIn) {
                      router.push("/login");
                      return;
                    }
                    router.push(`/mock/${mid}${mockQuerySuffix}`);
                  }}
                  className="ms-btn-primary ms-cta-fill group/btn flex w-full items-center justify-center gap-3 rounded-2xl py-4 text-sm font-black uppercase tracking-widest active:scale-[0.98]"
                >
                  Enter timed mock
                  <ArrowRight className="h-5 w-5 transition-transform group-hover/btn:translate-x-1" />
                </button>
              </div>
            </div>
          );
        })}

        {groupedExams.length === 0 ? (
          <div className="col-span-full mx-auto max-w-2xl rounded-[40px] border-2 border-dashed border-border bg-card px-8 py-24 text-center">
            <FileText className="mx-auto mb-4 h-12 w-12 text-label-foreground/40" />
            <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">No mock exams here yet</p>
            <p className="mt-3 text-sm leading-relaxed text-label-foreground">
              Nothing is listed until an admin publishes a <strong className="text-foreground">timed mock</strong> and assigns you on the portal.
              These exams are authored for assessment only—not linked to pastpaper practice tests. Practice real released forms under{" "}
              <strong className="text-foreground">Pastpaper tests</strong> first.
            </p>
          </div>
        ) : null}
        {groupedExams.length > 0 && filtered.length === 0 ? (
          <div className="col-span-full py-16 text-center text-sm font-medium text-muted-foreground">No matches for your filters.</div>
        ) : null}
      </div>
    </div>
  );
}
