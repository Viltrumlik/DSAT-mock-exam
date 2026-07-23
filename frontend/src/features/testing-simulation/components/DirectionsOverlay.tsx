"use client";
import type { ExamSubjectKind } from "../types";

interface DirectionsOverlayProps {
  /** Viewport-Y of the header's bottom edge — the popover hangs from just below it. */
  anchorBottom: number;
  /** Width of the left (passage) pane as a %, so the card covers it like Bluebook. */
  widthPct: number;
  subject: ExamSubjectKind;
  onClose: () => void;
}

/**
 * Bluebook-style Directions popover: a white card that drops from the "Directions"
 * button, covers the left/passage region (not full height — leaves a gap at the
 * bottom so the question stays visible), with an upward pointer and a gold Close
 * button. Content is section-specific (Reading & Writing vs Math).
 */
export function DirectionsOverlay({ anchorBottom, widthPct, subject, onClose }: DirectionsOverlayProps) {
  const isMath = subject === "MATH";
  return (
    <div
      role="dialog"
      aria-label="Directions"
      className="fixed left-0 z-[60] flex flex-col rounded-b-2xl bg-white p-8 shadow-2xl"
      style={{ top: anchorBottom + 6, width: `calc(${widthPct}% + 44px)`, bottom: 150 }}
    >
      {/* Upward pointer toward the Directions button. */}
      <div className="absolute -top-2 left-10 h-4 w-4 rotate-45 rounded-[2px] bg-white" aria-hidden />
      <div className="font-[Georgia] text-[17px] leading-relaxed text-slate-900">
        {isMath ? (
          <>
            <p className="mb-4">
              The questions in this section address a number of important math skills. Use of a calculator is
              permitted for all questions.
            </p>
            <p>
              For <strong>multiple-choice questions</strong>, solve each problem and choose the correct answer from
              the choices provided. For <strong>student-produced response questions</strong>, solve each problem and
              enter your answer as described below.
            </p>
          </>
        ) : (
          <>
            <p className="mb-4">
              The questions in this section address a number of important reading and writing skills. Each question
              includes one or more passages, which may include a table or graph. Read each passage and question
              carefully, and then choose the best answer to the question based on the passage(s).
            </p>
            <p>All questions in this section are multiple-choice with four answer choices. Each question has a single best answer.</p>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-auto self-end rounded-full bg-[#f9da4a] px-8 py-2.5 text-sm font-bold text-slate-900 transition-colors hover:bg-[#f4cf22]"
      >
        Close
      </button>
    </div>
  );
}
