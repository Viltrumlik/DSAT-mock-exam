"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { listAllQuestions, applyClientFilters, computeQuestionBankStats } from "@/domains/questions/api";
import type { QuestionWithContext, QuestionBankFilters } from "@/domains/questions/types";
import { Search, Plus, Filter, BookOpen, PenLine } from "lucide-react";
import { cn } from "@/lib/cn";
import { StateTag, QuestionLineage } from "@/components/governance";
import { useDebounce } from "@/hooks/useDebounce";
import {
  STUDIO_BOX_CAPTION,
  STUDIO_BTN_PRIMARY,
  STUDIO_BTN_SECONDARY,
  STUDIO_CARD,
  STUDIO_ERROR_BANNER,
  STUDIO_LINK,
  STUDIO_PAGE_DESC,
  STUDIO_PAGE_TITLE,
  STUDIO_SELECT,
} from "@/components/studio/primitives";

/** Maximum questions rendered to DOM at one time. Performance safety valve.
 *  When exceeded, a "Showing N of M — narrow your search" indicator is shown.
 *  Threshold for server-side pagination: when allQuestions.length > 300, log a
 *  warning to signal that a paginated API migration is becoming necessary. */
const RENDER_CAP = 150;
const PAGINATION_WARN_THRESHOLD = 300;

const QUESTION_TYPE_LABELS: Record<string, string> = {
  multiple_choice: "MC",
  numeric: "Numeric",
  short_text: "Text",
  boolean: "T/F",
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

  // Debounce the search string — avoids filtering on every keystroke.
  const debouncedSearch = useDebounce(filters.search ?? "", 200);
  const filtersForSearch = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debouncedSearch, filters.subject, filters.questionType, filters.activeStatus, filters.setId],
  );

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
        if (!cancelled) {
          setAllQuestions(data);
          // Payload growth warning — signals when server-side pagination is needed.
          if (data.length > PAGINATION_WARN_THRESHOLD) {
            console.warn(
              `[QuestionBank] Loaded ${data.length} questions client-side. ` +
              `Consider migrating to server-side pagination when this exceeds ${PAGINATION_WARN_THRESHOLD}.`,
            );
          }
        }
      } catch (e: unknown) {
        const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        if (!cancelled) setError(typeof detail === "string" ? detail : "Could not load questions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filters.subject]);

  // Client-side filtering for everything else (using debounced search).
  const filtered = useMemo(
    () => applyClientFilters(allQuestions, filtersForSearch),
    [allQuestions, filtersForSearch],
  );

  // Render cap: limit DOM nodes for performance. Show indicator when cap is hit.
  const visible = useMemo(() => filtered.slice(0, RENDER_CAP), [filtered]);
  const isCapped = filtered.length > RENDER_CAP;

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={STUDIO_PAGE_TITLE}>Question Bank</h1>
          <p className={STUDIO_PAGE_DESC}>
            Read-only view across all assessment sets. To edit a question, open it inside its
            set — questions are authored and managed from the set editor.
          </p>
        </div>
        <Link
          href="/builder/sets"
          className={STUDIO_BTN_PRIMARY}
        >
          <Plus className="h-3.5 w-3.5" />
          Add questions via set
        </Link>
      </div>

      {/* Stats strip — one hairline box, a figure per cell */}
      {!loading && !error && (
        <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border sm:grid-cols-4">
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
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search by prompt, set name, or category…"
            value={filters.search ?? ""}
            onChange={(e) => patchFilter({ search: e.target.value })}
            className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </div>

        {/* Subject */}
        <select
          value={filters.subject ?? "all"}
          onChange={(e) => patchFilter({ subject: e.target.value as QuestionBankFilters["subject"] })}
          className={STUDIO_SELECT}
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
            "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            showFilters
              ? "border-primary/30 bg-primary/10 text-primary dark:text-primary-hover"
              : "border-border bg-card text-foreground hover:bg-surface-2",
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
        </button>
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div className="flex flex-wrap gap-3 border border-border bg-card px-3 py-2">
          <div className="flex flex-col gap-1 min-w-[140px]">
            <span className="text-[12px] font-semibold text-muted-foreground">
              Question type
            </span>
            <select
              value={filters.questionType ?? "all"}
              onChange={(e) =>
                patchFilter({ questionType: e.target.value as QuestionBankFilters["questionType"] })
              }
              className={STUDIO_SELECT}
            >
              <option value="all">All types</option>
              <option value="multiple_choice">Multiple choice</option>
              <option value="numeric">Numeric</option>
              <option value="short_text">Short text</option>
              <option value="boolean">True / False</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-[140px]">
            <span className="text-[12px] font-semibold text-muted-foreground">
              Status
            </span>
            <select
              value={filters.activeStatus ?? "all"}
              onChange={(e) =>
                patchFilter({
                  activeStatus: e.target.value as QuestionBankFilters["activeStatus"],
                })
              }
              className={STUDIO_SELECT}
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-[200px] flex-1">
            <span className="text-[12px] font-semibold text-muted-foreground">
              Assessment set
            </span>
            <select
              value={filters.setId ?? "all"}
              onChange={(e) => {
                const v = e.target.value;
                patchFilter({ setId: v === "all" ? "all" : Number(v) });
              }}
              className={STUDIO_SELECT}
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
              className={STUDIO_BTN_SECONDARY}
            >
              Reset filters
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className={STUDIO_ERROR_BANNER}>
          {error}
        </div>
      )}

      {/* Question list */}
      <div className={STUDIO_CARD}>
        <div className={cn(STUDIO_BOX_CAPTION, "flex items-center justify-between gap-2")}>
          <p className="tabular-nums">
            {loading
              ? "Loading…"
              : isCapped
              ? `${filtered.length} questions (showing first ${RENDER_CAP})`
              : `${filtered.length} question${filtered.length === 1 ? "" : "s"}`}
          </p>
          {!loading && filtered.length !== allQuestions.length && (
            <p className="font-normal tabular-nums">{allQuestions.length} total</p>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            <BookOpen className="mx-auto mb-2 h-6 w-6 opacity-30" />
            <p className="font-medium">No questions match your filters.</p>
            <p className="mt-1 text-[13px]">
              Try broadening the filters, or{" "}
              <Link href="/builder/sets" className={STUDIO_LINK}>
                create questions inside an assessment set
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {visible.map((q) => (
                <QuestionCard key={`${q.setId}-${q.id}`} question={q} />
              ))}
            </div>
            {isCapped && (
              <div className="border-t border-border bg-surface-2/40 px-3 py-2 text-center text-[12px] text-muted-foreground">
                Showing {RENDER_CAP} of {filtered.length} results — narrow your search to see more.
              </div>
            )}
          </>
        )}
      </div>

      {/* Governance note */}
      <p className="text-[12px] text-muted-foreground text-center pb-2">
        A question is the live source of truth: editing it here updates it everywhere it&apos;s
        used, including in assessments.
      </p>
    </div>
  );
}

function QuestionCard({ question: q }: { question: QuestionWithContext }) {
  const typeLabel = QUESTION_TYPE_LABELS[q.question_type] ?? q.question_type;

  return (
    <div className="group flex items-start gap-3 px-3 py-2 hover:bg-surface-2">
      {/* Left: prompt + meta */}
      <div className="min-w-0 flex-1">
        <p
          className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground"
          title={q.prompt}
        >
          {q.prompt.trim() || <em className="text-muted-foreground/50">No prompt</em>}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[12px] font-medium text-muted-foreground">
            {typeLabel}
          </span>
          <QuestionLineage
            setId={q.setId}
            setTitle={q.setTitle}
            setIsPublished={q.setIsPublished}
          />
          {q.category && (
            <span className="text-[12px] text-muted-foreground">{q.category}</span>
          )}
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {q.points}pt
          </span>
        </div>
      </div>

      {/* Right: status + edit */}
      <div className="flex shrink-0 items-center gap-2">
        {q.is_active && q.setIsPublished ? (
          <StateTag state="IN_USE" size="xs" />
        ) : (
          <StateTag state={q.is_active ? "ACTIVE" : "ARCHIVED"} size="xs" />
        )}
        <Link
          href={`/builder/sets/${q.setId}?questionId=${q.id}`}
          className={STUDIO_BTN_SECONDARY}
          title={`Open in set "${q.setTitle}"`}
        >
          <PenLine className="h-3 w-3 text-muted-foreground" />
          Open in set →
        </Link>
      </div>
    </div>
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
    <div className="bg-card px-3 py-2">
      <p
        className={cn(
          "text-xl font-semibold tabular-nums",
          accent ? "text-primary dark:text-primary-hover" : dim ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
