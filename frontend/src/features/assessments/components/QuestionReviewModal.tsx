"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { PedagogicalReviewQuestion } from "@/features/assessmentsStudent/api";
import { QuestionDeepDive } from "./QuestionDeepDive";

/**
 * Pop-up per-question review for an assessment attempt — same interaction as the
 * pastpaper exam review modal (open one question, page through with Prev/Next).
 * Opened from the result page's per-question "Review" action.
 */
export function QuestionReviewModal({
  questions,
  index,
  onIndexChange,
  onClose,
}: {
  questions: PedagogicalReviewQuestion[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const total = questions.length;
  const q = questions[index];

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

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8">
      <div className="absolute inset-0 bg-foreground/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
          <p className="text-sm font-extrabold text-foreground">
            Question {index + 1} <span className="text-muted-foreground">/ {total}</span>
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-xl border border-border p-2 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — the shared per-question deep dive */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <QuestionDeepDive q={q} index={index} total={total} />
        </div>

        {/* Footer — page through questions */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => onIndexChange(index - 1)}
            disabled={index <= 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-bold text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </button>
          <button
            type="button"
            onClick={() => onIndexChange(index + 1)}
            disabled={index >= total - 1}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
