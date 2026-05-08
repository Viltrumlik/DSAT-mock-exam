"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { listAllQuestions, applyClientFilters, computeQuestionBankStats } from "@/domains/questions/api";
import type { QuestionWithContext, QuestionBankFilters } from "@/domains/questions/types";
import { Search, Plus, Filter, ChevronRight, BookOpen, Edit2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { StateTag } from "@/components/governance";

const QUESTION_TYPE_LABELS: Record<string, string> = {
  multiple_choice: "MC",
  numeric: "Numeric",
  short_text: "Text",
  boolean: "T/F",
};

const QUESTION_TYPE_COLORS: Record<string, string> = {
  multiple_choice: "bg-blue-100 text-blue-800",
  numeric: "bg-purple-100 text-purple-800",
  short_text: "bg-teal-100 text-teal-800",
  boolean: "bg-orange-100 text-orange-800",
};

export default function QuestionBankPage() {
  const [allQuestions, setAllQuestions] = useState<QuestionWithContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<QuestionBankFilters>({
    subject: "all",
    questionType: "all",
    activeStatus: "all",
    setId: "all",
    search: "",
  });

  const [showFilters, setShowFilters] = useState(false);

  // Load questions; re-fetch when subject filter changes (server-side filter)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const subjectParam =
          filters.subject && filters.subject !== "all" ? filters.subject : undefined;
        const data = await listAllQuestions(subjectParam ? { subject: subjectParam } : undefined);
        if (!cancelled) setAllQuestions(data);
      } catch (e: unknown) {
        const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        if (!cancelled) setError(typeof detail === "string" ? detail : "Could not load questions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filters.subject]);

  // Client-side filtering for everything else
  const filtered = useMemo(
    () => applyClientFilters(allQuestions, filters),
    [allQuestions, filters],
  );

  const stats = useMemo(() => computeQuestionBankStats(allQuestions), [allQuestions]);

  // Unique set list for the set filter dropdown
  const setOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const q of allQuestions) map.set(q.setId, q.setTitle);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allQuestions]);

  const patchFilter = (patch: Partial<QuestionBankFilters>) =>
    setFilters((prev) => ({ ...prev, ...patch }));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">
            Questions console
          </p>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Question Bank</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All questions across every assessment set. Questions are reusable — they exist
            independently of any single assessment.
          </p>
        </div>
        <Link
          href="/builder/sets"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add questions via set
        </Link>
      </div>

      {/* Stats strip */}
      {!loading && !error && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniStat label="Total" value={stats.total} />
          <MiniStat label="Active" value={stats.active} accent />
          <MiniStat label="Sets" value={stats.setCount} />
          <MiniStat label="Inactive" value={stats.inactive} dim />
        </div>
      )}

      {/* Search + filter toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search by prompt, set name, or category…"
            value={filters.search ?? ""}
            onChange={(e) => patchFilter({ search: e.target.value })}
            className="w-full rounded-xl border border-border bg-card pl-9 pr-4 py-2 text-sm font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        {/* Subject */}
        <select
          value={filters.subject ?? "all"}
          onChange={(e) => patchFilter({ subject: e.target.value as QuestionBankFilters["subject"] })}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold"
        >
          <option value="all">All subjects</option>
          <option value="math">Math</option>
          <option value="english">English</option>
        </select>

        {/* Filter toggle */}
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-bold transition-colors",
            showFilters
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-surface-2",
          )}
        >
          <Filter className="h-4 w-4" />
          Filters
        </button>
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div className="flex flex-wrap gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-col gap-1 min-w-[140px]">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Question type
            </span>
            <select
              value={filters.questionType ?? "all"}
              onChange={(e) =>
                patchFilter({ questionType: e.target.value as QuestionBankFilters["questionType"] })
              }
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold"
            >
              <option value="all">All types</option>
              <option value="multiple_choice">Multiple choice</option>
              <option value="numeric">Numeric</option>
              <option value="short_text">Short text</option>
              <option value="boolean">True / False</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-[140px]">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Status
            </span>
            <select
              value={filters.activeStatus ?? "all"}
              onChange={(e) =>
                patchFilter({
                  activeStatus: e.target.value as QuestionBankFilters["activeStatus"],
                })
              }
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold"
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-[200px] flex-1">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Assessment set
            </span>
            <select
              value={filters.setId ?? "all"}
              onChange={(e) => {
                const v = e.target.value;
                patchFilter({ setId: v === "all" ? "all" : Number(v) });
              }}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold"
            >
              <option value="all">All sets</option>
              {setOptions.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() =>
                setFilters({
                  subject: "all",
                  questionType: "all",
                  activeStatus: "all",
                  setId: "all",
                  search: "",
                })
              }
              className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
            >
              Reset filters
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4 flex items-center justify-between gap-2">
          <p className="font-bold text-foreground">
            {loading ? "Loading…" : `${filtered.length} question${filtered.length === 1 ? "" : "s"}`}
          </p>
          {!loading && filtered.length !== allQuestions.length && (
            <p className="text-xs text-muted-foreground">
              {allQuestions.length} total
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center p-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <BookOpen className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No questions match your filters.</p>
            <p className="text-sm mt-1">
              Try broadening the filters, or{" "}
              <Link href="/builder/sets" className="font-bold text-primary hover:underline">
                create questions inside an assessment set
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-5 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                    Question
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap hidden md:table-cell">
                    Assessment set
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap hidden sm:table-cell">
                    Points
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((q) => (
                  <QuestionRow key={`${q.setId}-${q.id}`} question={q} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Governance note */}
      <p className="text-xs text-muted-foreground text-center pb-2">
        Questions in active assignments are protected by immutable snapshots. Editing an active
        question creates a new revision automatically.
      </p>
    </div>
  );
}

function QuestionRow({ question: q }: { question: QuestionWithContext }) {
  const typeLabel = QUESTION_TYPE_LABELS[q.question_type] ?? q.question_type;
  const typeColor =
    QUESTION_TYPE_COLORS[q.question_type] ?? "bg-slate-100 text-slate-700";

  // Truncate prompt for display; preserve leading whitespace
  const promptDisplay =
    q.prompt.length > 100
      ? q.prompt.replace(/\s+/g, " ").trim().slice(0, 100) + "…"
      : q.prompt.replace(/\s+/g, " ").trim() || "(no prompt)";

  return (
    <tr className="hover:bg-surface-2/50 transition-colors">
      {/* Prompt */}
      <td className="px-5 py-3 max-w-xs">
        <p className="font-medium text-foreground leading-snug line-clamp-2" title={q.prompt}>
          {promptDisplay}
        </p>
        {/* On mobile show the set name inline */}
        <p className="text-xs text-muted-foreground mt-0.5 md:hidden">
          {q.setTitle}
        </p>
      </td>

      {/* Type badge */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span
          className={cn(
            "inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-wide",
            typeColor,
          )}
        >
          {typeLabel}
        </span>
      </td>

      {/* Set name */}
      <td className="px-4 py-3 hidden md:table-cell max-w-[180px]">
        <Link
          href={`/builder/sets/${q.setId}`}
          className="text-sm font-semibold text-foreground hover:text-primary hover:underline truncate block"
          title={q.setTitle}
        >
          {q.setTitle}
        </Link>
        {q.category ? (
          <p className="text-xs text-muted-foreground truncate">{q.category}</p>
        ) : null}
      </td>

      {/* Points */}
      <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold tabular-nums text-foreground hidden sm:table-cell">
        {q.points}
      </td>

      {/* Status */}
      <td className="px-4 py-3 whitespace-nowrap">
        <StateTag state={q.is_active ? "ACTIVE" : "ARCHIVED"} size="xs" />
      </td>

      {/* Actions */}
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <Link
          href={`/builder/sets/${q.setId}`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
          title={`Edit question in set "${q.setTitle}"`}
        >
          <Edit2 className="h-3 w-3" />
          Edit
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </Link>
      </td>
    </tr>
  );
}

function MiniStat({
  label,
  value,
  accent,
  dim,
}: {
  label: string;
  value: number;
  accent?: boolean;
  dim?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p
        className={cn(
          "text-xl font-extrabold tabular-nums",
          accent ? "text-primary" : dim ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value.toLocaleString()}
      </p>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
        {label}
      </p>
    </div>
  );
}
