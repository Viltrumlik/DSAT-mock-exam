"use client";
import { Flag } from "lucide-react";
import type { ExamQuestion } from "../types";
import { SatColorRule } from "./SatColorRule";

interface CheckYourWorkPageProps {
  moduleTitle: string;
  questions: ExamQuestion[];
  answers: Record<string, string>;
  flagged: number[];
  /** Jump back to a specific question (closes this page). */
  onJump: (index: number) => void;
  /** Return to the last question without submitting. */
  onBack: () => void;
  /** Confirm + submit the module. */
  onSubmit: () => void;
  submitting: boolean;
  /** Drives the primary button label: last module finishes; otherwise continues. */
  isLastModule: boolean;
  /**
   * When true (midterms), the student can't submit or advance manually — the
   * button is replaced by a note; the test submits only when the timer expires.
   */
  submitLocked?: boolean;
  studentName?: string;
}

/**
 * Bluebook-style "Check Your Work" review page (item: Check Your Work Page).
 * Shown before a module is submitted: intro copy + a status legend and a
 * question grid the student can jump from, plus Back / Submit in the footer.
 * Reached from the footer's last-question action or the navigator's
 * "Go to Review Page".
 */
export function CheckYourWorkPage({
  moduleTitle,
  questions,
  answers,
  flagged,
  onJump,
  onBack,
  onSubmit,
  submitting,
  isLastModule,
  submitLocked = false,
  studentName,
}: CheckYourWorkPageProps) {
  return (
    <div className="ts-runner flex h-screen flex-col bg-white">
      <SatColorRule />

      <main className="flex-1 overflow-y-auto bg-[#f6f7f8] px-6 py-10">
        <h1 className="text-center text-[34px] font-normal tracking-tight text-slate-900">Check Your Work</h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-[17px] text-slate-600">
          On test day, you won&rsquo;t be able to move on to the next module until time expires.
        </p>
        <p className="mx-auto mt-1.5 max-w-2xl text-center text-[17px] text-slate-600">
          For these practice questions, you can click <span className="font-bold">Next</span> when you&rsquo;re ready to
          move on.
        </p>

        <div className="mx-auto mt-8 max-w-4xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3.5">
            <h2 className="text-lg font-bold text-slate-900">{moduleTitle} Questions</h2>
            <div className="flex items-center gap-6 text-sm text-slate-600">
              <span className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 rounded-[3px] border border-dashed border-slate-400" /> Unanswered
              </span>
              <span className="flex items-center gap-2">
                <Flag className="h-4 w-4 fill-red-500 text-red-500" /> For Review
              </span>
            </div>
          </div>

          <div className="grid grid-cols-11 justify-items-center gap-3">
            {questions.map((q, i) => {
              const answered = Boolean(answers[q.id]);
              const isFlagged = flagged.includes(q.id);
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => onJump(i)}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-md text-sm font-bold transition-colors ${
                    answered
                      ? "border border-[#253985] bg-[#253985] text-white"
                      : "border border-dashed border-slate-400 text-[#2b47c9] hover:border-slate-600"
                  }`}
                >
                  {i + 1}
                  {isFlagged && <Flag className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 fill-red-500 text-red-500" />}
                </button>
              );
            })}
          </div>
        </div>
      </main>

      <SatColorRule />
      <footer className="flex shrink-0 items-center justify-between bg-white px-6 py-3">
        <span className="truncate text-[15px] font-bold text-slate-700">{studentName}</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full bg-[#253985] px-8 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#1d2d6b]"
          >
            Back
          </button>
          {submitLocked ? (
            <p className="max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900">
              Keep reviewing your answers — you can&apos;t submit early. The midterm submits automatically when time runs
              out.
            </p>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="rounded-full bg-[#253985] px-8 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#1d2d6b] disabled:opacity-60"
            >
              {submitting ? "Submitting…" : isLastModule ? "Submit" : "Next"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
