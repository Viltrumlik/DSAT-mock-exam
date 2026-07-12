"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, BookOpen, CheckCircle2, ChevronRight, Flag, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { PedagogicalReviewQuestion } from "@/features/assessmentsStudent/api";
import { ReportProblemModal } from "@/features/question-reports/ReportProblemModal";
import { QuestionDeepDive, getQuestionOutcome, OUTCOME_META } from "./QuestionDeepDive";

/**
 * Pop-up per-question review for an assessment attempt — a wide (≈80% viewport),
 * full-screen two-pane modal that mirrors the pastpaper exam review: question
 * content on the left, stimulus + answer analysis on the right. Correct-answer
 * reveals honour the page's "Show correct answers" toggle via `showAnswers`.
 */
export function QuestionReviewModal({
  questions,
  index,
  showAnswers = true,
  onIndexChange,
  onClose,
}: {
  questions: PedagogicalReviewQuestion[];
  index: number;
  /** When false, correct choices / correct-answer boxes / explanations stay hidden. */
  showAnswers?: boolean;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const total = questions.length;
  const q = questions[index];
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && index < total - 1) onIndexChange(index + 1);
      else if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [index, total, onIndexChange, onClose]);

  if (!q || typeof document === "undefined") return null;

  const outcome = getQuestionOutcome(q);
  const meta = OUTCOME_META[outcome];

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-8">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[24px] border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl border",
                outcome === "correct"
                  ? "border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/10"
                  : outcome === "incorrect"
                    ? "border-rose-100 bg-rose-50 text-rose-500 dark:border-rose-500/20 dark:bg-rose-500/10"
                    : "border-amber-100 bg-amber-50 text-amber-500 dark:border-amber-500/20 dark:bg-amber-500/10",
              )}
            >
              {outcome === "correct" ? <CheckCircle2 className="h-5 w-5" />
                : outcome === "incorrect" ? <XCircle className="h-5 w-5" />
                  : <BookOpen className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-base font-extrabold text-foreground">
                Question {index + 1} <span className="text-muted-foreground">/ {total}</span>
              </p>
              <p className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider", meta.badge)}>
                {meta.label}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Flag className="h-4 w-4" /> Report
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-xl border border-border p-2 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <ReportProblemModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          target={q.id ? { system: "assessment", questionId: Number(q.id) } : null}
          questionNumber={index + 1}
        />

        {/* Body — the shared two-pane deep dive */}
        <div className="min-h-0 flex-1">
          <QuestionDeepDive q={q} showAnswers={showAnswers} />
        </div>

        {/* Footer — page through questions */}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-6 py-3">
          <button
            type="button"
            onClick={() => onIndexChange(index - 1)}
            disabled={index <= 0}
            className="inline-flex items-center gap-1.5 rounded-full border-2 border-foreground px-7 py-2 text-sm font-bold text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <button
            type="button"
            onClick={() => onIndexChange(index + 1)}
            disabled={index >= total - 1}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-7 py-2 text-sm font-bold text-primary-foreground shadow-md transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
