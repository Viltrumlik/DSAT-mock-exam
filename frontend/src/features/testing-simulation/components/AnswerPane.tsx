"use client";
import { memo } from "react";
import { Bookmark } from "lucide-react";
import SafeHtml from "@/components/SafeHtml";
import type { ExamQuestion } from "../types";
import { ChoiceList } from "./ChoiceList";
import { SatColorRule } from "./SatColorRule";
import { SprInput } from "./SprInput";
import { renderExamHtml } from "../utils/richContent";
import { resolveImageUrl } from "../utils/image";

interface AnswerPaneProps {
  question: ExamQuestion;
  displayNumber: number;
  zoom: number;
  isMath: boolean;
  flagged: boolean;
  onToggleFlag: () => void;
  eliminationMode: boolean;
  onToggleEliminationMode: () => void;
  answer: string | undefined;
  eliminated: string[];
  onSelect: (key: string) => void;
  onEliminate: (key: string) => void;
  style?: React.CSSProperties;
  /** Left space (px) to reserve when the calculator is open, so the floating
   *  Desmos window never covers the question content. 0 = no calculator. */
  calcReserve?: number;
}

/** Right pane: question header (number, Mark for Review, eliminate toggle) + answer area. */
export const AnswerPane = memo(function AnswerPane({
  question,
  displayNumber,
  zoom,
  isMath,
  flagged,
  onToggleFlag,
  eliminationMode,
  onToggleEliminationMode,
  answer,
  eliminated,
  onSelect,
  onEliminate,
  style,
  calcReserve = 0,
}: AnswerPaneProps) {
  const isSpr = Boolean(question.is_math_input);
  // Math is single-pane (no PassagePane), so the question figure is rendered here.
  const figure = isMath ? resolveImageUrl(question.question_image) : undefined;
  return (
    <div
      className="min-w-0 overflow-y-auto overflow-x-hidden bg-white p-10 pb-8 transition-[padding] duration-300 ease-out"
      style={{ fontSize: `${15 * zoom}px`, ...(calcReserve > 0 ? { paddingLeft: calcReserve } : null), ...style }}
    >
      <div className={`w-full max-w-3xl ${calcReserve > 0 ? "mr-auto" : "mx-auto"}`}>
        {/* Question header: black number block + grey band (Bluebook). */}
        <div className="mb-0 flex items-stretch overflow-hidden rounded-[3px]">
          <span className="flex items-center bg-[#151515] px-3 py-1.5 text-lg font-bold tracking-tight text-white">
            {displayNumber}
          </span>
          <div className="flex flex-1 items-center justify-between bg-[#eceef1] px-3">
            <button
              type="button"
              onClick={onToggleFlag}
              className={`flex items-center gap-2 text-[15px] transition-colors ${flagged ? "font-bold text-[#b0122a] underline underline-offset-[3px]" : "text-slate-700 hover:text-slate-900"}`}
            >
              <Bookmark className={`h-[19px] w-[17px] ${flagged ? "fill-[#b0122a] text-[#b0122a]" : "fill-none text-slate-500"}`} />
              {flagged ? "Marked for Review" : "Mark for Review"}
            </button>
            {/* Answer-elimination toggle is meaningless for SPR (no choices). */}
            {!isSpr && (
              <button
                type="button"
                onClick={onToggleEliminationMode}
                title="Cross out answer choices"
                aria-pressed={eliminationMode}
                className={`relative flex h-[26px] w-[34px] items-center justify-center rounded-[5px] border-[1.5px] transition-colors ${eliminationMode ? "border-[#2b47c9] bg-[#2b47c9] text-white" : "border-slate-500 bg-white text-slate-800 hover:border-slate-700"}`}
              >
                <span className="text-[11px] font-extrabold italic leading-none tracking-tight">ABC</span>
                <span className="absolute left-[3px] right-[3px] top-1/2 h-[1.6px] -translate-y-1/2 -rotate-[10deg] bg-current" />
              </button>
            )}
          </div>
        </div>

        {/* SAT multi-colour rule under the question header. */}
        <SatColorRule className="mb-8 mt-0" />
        {/* Math question figure (single-pane layout has no PassagePane). */}
        {figure && (
          <div className="mb-6 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={figure}
              alt="Question figure"
              className="max-h-[360px] max-w-full rounded-lg border border-slate-100 bg-slate-50 object-contain p-2"
            />
          </div>
        )}

        {/* Highlightable question content (prompt for RW, stem for math). The
            annotator targets this container when there is no passage pane. */}
        <div id="ts-question">
          {question.question_prompt && !isSpr && (
            <SafeHtml
              className="mathjax-process mb-8 font-[Georgia] font-medium leading-relaxed text-slate-900"
              style={{ fontSize: `${16 * zoom * 1.2}px` }}
              html={renderExamHtml(question.question_prompt)}
            />
          )}
          {isMath && (
            <SafeHtml
              className="mathjax-process mb-8 font-[Georgia] font-medium leading-relaxed text-slate-900"
              style={{ fontSize: `${16 * zoom * 1.2}px` }}
              html={renderExamHtml(question.question_text)}
            />
          )}
        </div>

        {isSpr ? (
          <SprInput value={answer ?? ""} onChange={onSelect} />
        ) : (
          <div id="ts-choices">
            <ChoiceList
              question={question}
              selected={answer}
              eliminated={eliminated}
              eliminationMode={eliminationMode}
              onSelect={onSelect}
              onEliminate={onEliminate}
            />
          </div>
        )}
      </div>
    </div>
  );
});
