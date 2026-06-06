"use client";
import { ChevronUp } from "lucide-react";

interface ExamFooterProps {
  navLabel: string;
  onToggleNavigator: () => void;
  canGoBack: boolean;
  onBack: () => void;
  isLastQuestion: boolean;
  onNext: () => void;
  onSubmitModule: () => void;
  submitting: boolean;
  /** Autosave / connectivity status (empty string hides it). */
  saveLabel?: string;
  saveTone?: "muted" | "warn" | "ok";
}

/** Bottom bar: question-grid toggle + Back / Next / Submit. */
export function ExamFooter({
  navLabel,
  onToggleNavigator,
  canGoBack,
  onBack,
  isLastQuestion,
  onNext,
  onSubmitModule,
  submitting,
  saveLabel,
  saveTone = "muted",
}: ExamFooterProps) {
  const toneClass = saveTone === "warn" ? "text-amber-600" : saveTone === "ok" ? "text-emerald-600" : "text-slate-400";
  return (
    <footer className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-6 py-3">
      <div className="flex flex-1 items-center">
        {saveLabel ? (
          <span className={`text-xs font-semibold ${toneClass}`} role="status" aria-live="polite">
            {saveLabel}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onToggleNavigator}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
      >
        {navLabel}
        <ChevronUp className="h-4 w-4" />
      </button>
      <div className="flex flex-1 justify-end gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          className="rounded-full px-5 py-2 text-sm font-bold text-blue-700 disabled:opacity-30"
        >
          Back
        </button>
        {isLastQuestion ? (
          <button
            type="button"
            onClick={onSubmitModule}
            disabled={submitting}
            className="rounded-full bg-blue-700 px-6 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="rounded-full bg-blue-700 px-6 py-2 text-sm font-bold text-white hover:bg-blue-800"
          >
            Next
          </button>
        )}
      </div>
    </footer>
  );
}
