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
  /** Student identity — shown at the bottom-left throughout the test. */
  studentName?: string;
  /** When true, Back/Next are briefly locked (anti double-click). */
  navLocked?: boolean;
}

/** Bottom bar: student identity + question-grid toggle + Back / Next / Submit. */
export function ExamFooter({
  navLabel,
  onToggleNavigator,
  canGoBack,
  onBack,
  isLastQuestion,
  onNext,
  onSubmitModule,
  submitting,
  studentName,
  navLocked = false,
}: ExamFooterProps) {
  return (
    <footer className="flex shrink-0 items-center justify-between bg-white px-6 py-3">
      {/* Left: persistent student identity. */}
      <div className="flex flex-1 items-center">
        {studentName ? (
          <span className="truncate text-[15px] font-bold text-slate-700" title={studentName}>
            {studentName}
          </span>
        ) : null}
      </div>

      {/* Center: the question-navigator pill (Bluebook near-black rounded pill). */}
      <div className="flex flex-col items-center">
        <button
          type="button"
          onClick={onToggleNavigator}
          aria-haspopup="dialog"
          className="inline-flex items-center gap-2 rounded-full bg-[#151515] px-6 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#2a2a2a]"
        >
          {navLabel}
          <ChevronUp className="h-4 w-4" />
        </button>
      </div>

      {/* Right: Back + Next/Submit (both Bluebook indigo). */}
      <div className="flex flex-1 items-center justify-end gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack || navLocked}
          className="rounded-full bg-[#253985] px-9 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#1d2d6b] disabled:opacity-40"
        >
          Back
        </button>
        {isLastQuestion ? (
          <button
            type="button"
            onClick={onSubmitModule}
            disabled={submitting || navLocked}
            className="rounded-full bg-[#253985] px-9 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#1d2d6b] disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            disabled={navLocked}
            className="rounded-full bg-[#253985] px-9 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#1d2d6b] disabled:opacity-60"
          >
            Next
          </button>
        )}
      </div>
    </footer>
  );
}
