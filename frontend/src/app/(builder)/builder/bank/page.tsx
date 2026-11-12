"use client";

/**
 * /builder/bank — the Old sets bank: every question across the assessment sets, read-only. A question is edited
 * inside its set.
 *
 * In the console's look (design handoff v0.3, PR 20). The words, the filters and the call are the page's own.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { applyClientFilters, computeQuestionBankStats, listAllQuestions } from "@/domains/questions/api";
import type { QuestionBankFilters, QuestionWithContext } from "@/domains/questions/types";
import { LibraryError, LibraryHeader } from "@/features/builderLibrary/sectionParts";
import { Badge, Button, EmptyState, SearchField, StatTile, buttonClass, type BadgeTone } from "@/features/console/ui";
import { CONTROL, FIELD_LABEL } from "@/features/questionsAdmin/questionLook";

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

const QUESTION_TYPE_TONES: Record<string, BadgeTone> = {
  multiple_choice: "info",
  numeric: "frozen",
  short_text: "neutral",
  boolean: "attention",
};

const EMPTY_FILTERS: QuestionBankFilters = {
  subject: "all",
  questionType: "all",
  activeStatus: "all",
  setId: "all",
  search: "",
};

export default function QuestionBankPage() {
  const [allQuestions, setAllQuestions] = useState<QuestionWithContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<QuestionBankFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  // Load questions; re-fetch when subject filter changes (server-side filter)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const subjectParam = filters.subject && filters.subject !== "all" ? filters.subject : undefined;
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
    return () => {
      cancelled = true;
    };
  }, [filters.subject]);

  // Client-side filtering for everything else. The search field debounces what it sends.
  const filtered = useMemo(() => applyClientFilters(allQuestions, filters), [allQuestions, filters]);

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

  const patchFilter = (patch: Partial<QuestionBankFilters>) => setFilters((prev) => ({ ...prev, ...patch }));

  return (
    <div className="flex flex-col gap-5">
      <LibraryHeader
        eyebrow="Archive"
        title="Old sets bank"
        description="Read-only view across all assessment sets. To edit a question, open it inside its set — questions are authored and managed from the set editor."
        actions={
          <Link href="/builder/sets" className={buttonClass({ variant: "primary" })}>
            <Icon name="plus" size="sm" />
            Add questions via set
          </Link>
        }
      />

      {/* Stats strip */}
      {!loading && !error && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Total" value={stats.total.toLocaleString()} icon="ms-question" />
          <StatTile label="Active" value={stats.active.toLocaleString()} icon="ok" delay={40} />
          <StatTile label="Sets" value={stats.setCount.toLocaleString()} icon="layers" delay={80} />
          <StatTile label="Inactive" value={stats.inactive.toLocaleString()} icon="archive" delay={120} />
        </div>
      )}

      {/* Search + filter toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] flex-1">
          <SearchField
            value={filters.search ?? ""}
            placeholder="Search by prompt, set name, or category…"
            onSearch={(q) => patchFilter({ search: q })}
          />
        </div>
        <div className="w-[170px]">
          <select
            aria-label="Subject"
            value={filters.subject ?? "all"}
            onChange={(e) => patchFilter({ subject: e.target.value as QuestionBankFilters["subject"] })}
            className={CONTROL}
          >
            <option value="all">All subjects</option>
            <option value="math">Math</option>
            <option value="english">English</option>
          </select>
        </div>
        <Button
          variant={showFilters ? "subtle" : "secondary"}
          icon="filter"
          aria-expanded={showFilters}
          aria-controls="bank-filters"
          onClick={() => setShowFilters((v) => !v)}
        >
          Filters
        </Button>
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div
          id="bank-filters"
          className="animate-ms-fade-in grid gap-3 rounded-ms-card bg-ms-card p-4 shadow-ms-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end"
        >
          <div>
            <label htmlFor="bank-type" className={FIELD_LABEL}>
              Question type
            </label>
            <select
              id="bank-type"
              value={filters.questionType ?? "all"}
              onChange={(e) => patchFilter({ questionType: e.target.value as QuestionBankFilters["questionType"] })}
              className={CONTROL}
            >
              <option value="all">All types</option>
              <option value="multiple_choice">Multiple choice</option>
              <option value="numeric">Numeric</option>
              <option value="short_text">Short text</option>
              <option value="boolean">True / False</option>
            </select>
          </div>
          <div>
            <label htmlFor="bank-status" className={FIELD_LABEL}>
              Status
            </label>
            <select
              id="bank-status"
              value={filters.activeStatus ?? "all"}
              onChange={(e) => patchFilter({ activeStatus: e.target.value as QuestionBankFilters["activeStatus"] })}
              className={CONTROL}
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>
          <div>
            <label htmlFor="bank-set" className={FIELD_LABEL}>
              Assessment set
            </label>
            <select
              id="bank-set"
              value={String(filters.setId ?? "all")}
              onChange={(e) => {
                const v = e.target.value;
                patchFilter({ setId: v === "all" ? "all" : Number(v) });
              }}
              className={CONTROL}
            >
              <option value="all">All sets</option>
              {setOptions.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </div>
          <Button variant="secondary" icon="undo" onClick={() => setFilters(EMPTY_FILTERS)}>
            Reset filters
          </Button>
        </div>
      )}

      {error ? <LibraryError>{error}</LibraryError> : null}

      {/* Question list */}
      <section aria-label="Questions" className="animate-ms-card-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ms-line px-5 py-3.5">
          <p className="text-[15px] font-semibold text-ms-fg">
            {loading
              ? "Loading…"
              : isCapped
                ? `${filtered.length} questions (showing first ${RENDER_CAP})`
                : `${filtered.length} question${filtered.length === 1 ? "" : "s"}`}
          </p>
          {!loading && filtered.length !== allQuestions.length ? (
            <p className="text-[13px] text-ms-fg-3">{allQuestions.length} total</p>
          ) : null}
        </div>

        {loading ? (
          <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-ms-shimmer rounded-ms-ctl bg-ms-surface-2" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="search"
              title="No questions match your filters."
              detail="Try broadening the filters, or create questions inside an assessment set."
              action={
                <Link href="/builder/sets" className={buttonClass({ variant: "secondary" })}>
                  Assessments
                  <Icon name="right" size="sm" />
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <ul className="divide-y divide-ms-line">
              {visible.map((q) => (
                <QuestionRow key={`${q.setId}-${q.id}`} question={q} />
              ))}
            </ul>
            {isCapped ? (
              <div className="border-t border-ms-line bg-ms-surface px-5 py-3 text-center text-[13px] text-ms-fg-3">
                Showing {RENDER_CAP} of {filtered.length} results — narrow your search to see more.
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* Governance note */}
      <p className="pb-2 text-center text-[13px] text-ms-fg-3">
        A question is the live source of truth: editing it here updates it everywhere it&apos;s used, including in
        assessments.
      </p>
    </div>
  );
}

function QuestionRow({ question: q }: { question: QuestionWithContext }) {
  const typeLabel = QUESTION_TYPE_LABELS[q.question_type] ?? q.question_type;
  const typeTone = QUESTION_TYPE_TONES[q.question_type] ?? "line";

  return (
    <li
      data-question={`${q.setId}-${q.id}`}
      className="ms-transition flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 py-4 hover:bg-ms-surface"
    >
      <div className="min-w-0 flex-1 basis-[18rem]">
        <p className="line-clamp-2 text-[15px] font-medium leading-[22px] text-ms-fg" title={q.prompt}>
          {q.prompt.trim() || <em className="text-ms-fg-3">No prompt</em>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
          <Badge tone={typeTone}>{typeLabel}</Badge>
          {/* The set it lives in: a published set means an edit makes a new revision. */}
          <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
            <Link
              href={`/builder/sets/${q.setId}`}
              title={`Open set: ${q.setTitle}`}
              className="block max-w-[220px] truncate font-semibold text-ms-fg hover:text-ms-primary-text"
            >
              {q.setTitle}
            </Link>
            {q.setIsPublished ? (
              <>
                <Badge tone="info">In use</Badge>
                <span className="text-[12px] text-ms-fg-3">edits create new revision</span>
              </>
            ) : (
              <Badge tone="line">Free</Badge>
            )}
          </span>
          {q.category ? <span className="text-ms-fg-3">{q.category}</span> : null}
          <span className="tabular-nums text-ms-fg-3">{q.points}pt</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {q.is_active && q.setIsPublished ? (
          <Badge tone="info" dot>
            In use
          </Badge>
        ) : q.is_active ? (
          <Badge tone="positive" dot>
            Active
          </Badge>
        ) : (
          <Badge tone="neutral">Archived</Badge>
        )}
        <Link
          href={`/builder/sets/${q.setId}?questionId=${q.id}`}
          title={`Open in set "${q.setTitle}"`}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          <Icon name="pencil" size="sm" />
          Open in set →
        </Link>
      </div>
    </li>
  );
}
