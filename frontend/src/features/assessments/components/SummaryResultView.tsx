"use client";

/**
 * Presentational body for the assessment result *summary* screen.
 *
 * Pure + data-driven so both the real page
 * (app/(main)/assessments/result/[assignmentId]/page.tsx) and the design
 * preview can render identical markup. 1:1 with summary.design.png:
 * gradient hero (no ring), 4-column stat strip, breakdown table with a
 * dark header row.
 */

import { useMemo, useState } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { spawnRipple } from "@/features/classroom/ui/ripple";

const JAKARTA = "var(--font-plus-jakarta), system-ui, sans-serif";

export type SummaryRowStatus = "correct" | "incorrect" | "omitted";
export type SummaryFilterKey = "all" | "wrong" | "correct";
export type SummaryPerPage = 10 | 30 | "all";

export interface SummaryRow {
  /** stable key */
  id: number;
  /** 0-based order → displayed as order+1 */
  order: number;
  status: SummaryRowStatus;
  /** correct answer letter/value (shown only when showAnswers) */
  correctDisplay: string;
  /** time spent on this question, seconds (0 → "—") */
  seconds: number;
}

const STATUS_META: Record<SummaryRowStatus, { label: string; tone: string }> = {
  correct: { label: "Correct", tone: "text-emerald-600 dark:text-emerald-400" },
  incorrect: { label: "Incorrect", tone: "text-rose-600 dark:text-rose-400" },
  omitted: { label: "Omitted", tone: "text-muted-foreground" },
};

/** s>=60 → "Xm Ys" else "Xs". */
export function fmtSummarySec(s: number): string {
  if (!s || s <= 0) return "0s";
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/** 1-based windowed pager: always shows 1, last, and current ±1 with ellipses. */
function pageWindow(page: number, count: number): (number | "…")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(count - 1, page + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < count - 1) out.push("…");
  out.push(count);
  return out;
}

export interface SummaryResultViewProps {
  /** UPPERCASE eyebrow inside hero (e.g. "MATHBOOK 2.0: TRIANGLES") */
  title: string;
  percent: number;
  correctCount: number;
  totalQuestions: number;
  totalTimeLabel: string;
  /** stat strip values */
  scorePoints: string;
  maxPoints: string;
  avgPerQuestionLabel: string;
  rows: SummaryRow[];
  onBack: () => void;
  /** Label for the top-left back button (default "Back to assignment"). */
  backLabel?: string;
  onReview: (row: SummaryRow) => void;
  /** Reveal-correct-answers toggle — controlled so the review modal can honour it too. */
  showAnswers: boolean;
  onToggleShowAnswers: () => void;
  /** Retry the whole assessment (start a fresh attempt). Optional. */
  onRetry?: () => void;
  retrying?: boolean;
}

export function SummaryResultView({
  title,
  percent,
  correctCount,
  totalQuestions,
  totalTimeLabel,
  scorePoints,
  maxPoints,
  avgPerQuestionLabel,
  rows,
  onBack,
  backLabel = "Back to assignment",
  onReview,
  showAnswers,
  onToggleShowAnswers,
  onRetry,
  retrying,
}: SummaryResultViewProps) {
  const [filter, setFilter] = useState<SummaryFilterKey>("all");
  const [perPage, setPerPage] = useState<SummaryPerPage>(10);
  const [page, setPage] = useState(1);

  const counts = useMemo(() => {
    let correct = 0, wrong = 0;
    for (const r of rows) {
      if (r.status === "correct") correct += 1;
      else wrong += 1;
    }
    return { all: rows.length, wrong, correct };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "correct") return rows.filter((r) => r.status === "correct");
    return rows.filter((r) => r.status === "incorrect" || r.status === "omitted");
  }, [rows, filter]);

  const effectivePerPage = perPage === "all" ? Math.max(1, filteredRows.length) : perPage;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / effectivePerPage));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageRows = filteredRows.slice((safePage - 1) * effectivePerPage, (safePage - 1) * effectivePerPage + effectivePerPage);
  const pager = pageWindow(safePage, pageCount);

  // No "Correct" filter — a student reviews what they got wrong, not what they got right.
  const filterDefs: { key: SummaryFilterKey; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "wrong", label: "Incorrect & Omitted", count: counts.wrong },
  ];
  const viewDefs: { key: SummaryPerPage; label: string }[] = [
    { key: 10, label: "10" },
    { key: 30, label: "30" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="cr-section flex w-full flex-col gap-[18px]" style={{ fontFamily: JAKARTA }}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="ds-ring group inline-flex w-fit items-center gap-2 rounded-lg text-sm font-bold text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-[17px] w-[17px]" /> {backLabel}
        </button>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="ds-ring inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-extrabold text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCcw className={cn("h-4 w-4", retrying && "animate-spin")} /> {retrying ? "Starting…" : "Retry assessment"}
          </button>
        ) : null}
      </div>

      {/* HERO — gradient banner + stat strip (no ring). */}
      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        {/* gradient score hero */}
        <div className="relative overflow-hidden bg-gradient-to-br from-primary to-primary-hover px-8 py-9 text-center text-primary-foreground">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-52 w-52 rounded-full bg-primary-foreground/[0.06]" />
          <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-primary-foreground/[0.05]" />
          <div className="relative text-lg font-extrabold tracking-[0.1em] text-primary-foreground/90">
            {title.toUpperCase()}
          </div>
          <div className="relative mb-2 mt-3.5 text-6xl font-extrabold leading-none tracking-tight tabular-nums">
            {percent}%
          </div>
          <div className="relative text-[15px] font-semibold text-primary-foreground/80">
            {correctCount} of {totalQuestions} correct · {totalTimeLabel}
          </div>
        </div>

        {/* stat strip */}
        <div className="grid grid-cols-2 border-t border-border sm:grid-cols-4">
          <StatCell label="POINTS" value={scorePoints} />
          <StatCell label="MAX POINTS" value={maxPoints} />
          <StatCell label="TOTAL TIME" value={totalTimeLabel} />
          <StatCell label="AVG PER QUESTION" value={avgPerQuestionLabel} accent last />
        </div>
      </div>

      {/* QUESTION BREAKDOWN */}
      <div className="rounded-[20px] border border-border bg-card px-7 py-6">
        <div className="mb-[18px] flex flex-wrap items-center gap-3.5">
          <h2 className="text-[19px] font-extrabold tracking-tight text-foreground">Question breakdown</h2>

          <div className="ml-auto inline-flex items-center gap-2.5">
            <span className="text-sm font-bold text-label-foreground">View:</span>
            {viewDefs.map((v, i) => {
              const on = perPage === v.key;
              return (
                <span key={String(v.key)} className="inline-flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => { setPerPage(v.key); setPage(1); }}
                    className={cn(
                      "ds-ring rounded text-sm font-extrabold transition-colors",
                      on ? "text-foreground" : "text-primary underline decoration-1 underline-offset-[3px] hover:text-primary-hover",
                    )}
                  >
                    {v.label}
                  </button>
                  {i < viewDefs.length - 1 ? <span className="font-semibold text-label-foreground">|</span> : null}
                </span>
              );
            })}
          </div>
        </div>

        {/* filter pills */}
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          {filterDefs.map((f) => {
            const on = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onPointerDown={spawnRipple}
                onClick={() => { setFilter(f.key); setPage(1); }}
                className={cn(
                  "cr-pillin cr-press cr-ripple inline-flex items-center gap-2 rounded-full border-[1.5px] px-[15px] py-2 text-[13.5px] font-bold transition-colors",
                  on
                    ? "border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900"
                    : "border-border bg-card text-foreground hover:bg-surface-2",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "ds-num rounded-full px-2 py-px text-[12px] font-extrabold",
                    on ? "bg-white/20 text-current" : "bg-surface-2 text-label-foreground",
                  )}
                >
                  {f.count}
                </span>
              </button>
            );
          })}

          {/* Show correct answers — right-aligned on the filter row so it sits under the
              View selector, parallel to the filter pills. */}
          <button
            type="button"
            onClick={onToggleShowAnswers}
            className="ds-ring ml-auto inline-flex select-none items-center gap-2.5 rounded-lg"
          >
            <span
              className={cn(
                "relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors",
                showAnswers ? "bg-primary" : "bg-slate-300 dark:bg-slate-600",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left]",
                  showAnswers ? "left-[22px]" : "left-0.5",
                )}
              />
            </span>
            <span className="text-sm font-bold text-foreground">Show correct answers</span>
          </button>
        </div>

        {/* table */}
        <div className="overflow-hidden rounded-[14px] border border-border">
          {/* dark header row */}
          <div className="grid grid-cols-[96px_1.1fr_1.1fr_110px_100px] bg-slate-800 dark:bg-slate-900">
            {["Question", "Correct Answer", "Your Answer", "Time", "Actions"].map((h, i) => (
              <div
                key={h}
                className={cn("px-[18px] py-[15px] text-[13.5px] font-extrabold text-white", i === 4 && "text-right")}
              >
                {h}
              </div>
            ))}
          </div>

          {pageRows.length === 0 ? (
            <div className="border-t border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No questions match this filter.
            </div>
          ) : (
            pageRows.map((row, i) => {
              const sm = STATUS_META[row.status];
              return (
                <div
                  key={row.id}
                  className="cr-rowin2 grid grid-cols-[96px_1.1fr_1.1fr_110px_100px] items-center border-t border-border transition-colors hover:bg-surface-2"
                  style={{ animationDelay: `${i * 45}ms` }}
                >
                  <div className="px-[18px] py-4 text-[15px] font-bold text-foreground">{row.order + 1}</div>
                  <div className="bg-surface-2/60 px-[18px] py-4 text-[15px] font-bold text-foreground">
                    {showAnswers ? (row.correctDisplay || "—") : "—"}
                  </div>
                  <div className={cn("px-[18px] py-4 text-[15px] font-extrabold", sm.tone)}>{sm.label}</div>
                  <div className="ds-num px-[18px] py-4 text-[15px] font-semibold text-foreground">
                    {row.seconds > 0 ? fmtSummarySec(row.seconds) : "—"}
                  </div>
                  <div className="px-[18px] py-4 text-right">
                    <button
                      type="button"
                      onClick={() => onReview(row)}
                      className="ds-ring rounded text-sm font-extrabold text-primary underline-offset-[3px] transition-colors hover:text-primary-hover hover:underline"
                    >
                      Review
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* pagination */}
        {pageCount > 1 ? (
          <div className="mt-[22px] flex items-center justify-center gap-2">
            <PagerButton ariaLabel="Previous page" disabled={safePage <= 1} onClick={() => setPage(Math.max(1, safePage - 1))}>
              <ArrowLeft className="h-[18px] w-[18px]" />
            </PagerButton>
            {pager.map((p, i) =>
              p === "…" ? (
                <span key={`gap-${i}`} className="inline-flex h-10 min-w-10 items-center justify-center text-sm font-extrabold text-label-foreground">…</span>
              ) : (
                <PagerButton key={p} active={p === safePage} onClick={() => setPage(p)}>{p}</PagerButton>
              ),
            )}
            <PagerButton ariaLabel="Next page" disabled={safePage >= pageCount} onClick={() => setPage(Math.min(pageCount, safePage + 1))}>
              <ArrowLeft className="h-[18px] w-[18px] rotate-180" />
            </PagerButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatCell({ label, value, accent, last }: { label: string; value: string; accent?: boolean; last?: boolean }) {
  return (
    <div className={cn("px-5 py-5 text-center", !last && "border-r border-border")}>
      <p className={cn("ds-num text-[22px] font-extrabold leading-tight", accent ? "text-primary" : "text-foreground")}>{value}</p>
      <p className="mt-1 text-[11px] font-extrabold tracking-[0.06em] text-label-foreground">{label}</p>
    </div>
  );
}

function PagerButton({
  children, active, disabled, ariaLabel, onClick,
}: {
  children: React.ReactNode; active?: boolean; disabled?: boolean; ariaLabel?: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      onPointerDown={spawnRipple}
      onClick={onClick}
      className={cn(
        "cr-ripple cr-press ds-ring inline-flex h-10 min-w-10 items-center justify-center rounded-xl border px-3 text-sm font-extrabold transition-colors disabled:pointer-events-none disabled:opacity-40",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}
