"use client";
import { memo } from "react";
import { Bookmark } from "lucide-react";
import SafeHtml from "@/components/SafeHtml";
import type { ExamQuestion } from "../types";
import { ChoiceList } from "./ChoiceList";
import { SprInput } from "./SprInput";

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
}: AnswerPaneProps) {
  const isSpr = Boolean(question.is_math_input);
  return (
    <div className="min-w-0 overflow-y-auto bg-white p-10 pb-8" style={{ fontSize: `${15 * zoom}px`, ...style }}>
      <div className="mx-auto w-full max-w-3xl">
        {/* Header bar */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <span className="flex items-center justify-center rounded-md bg-slate-900 px-3 py-1.5 text-sm font-bold tracking-tight text-white">
              {displayNumber}
            </span>
            <button
              type="button"
              onClick={onToggleFlag}
              className={`flex items-center text-xs font-bold transition-colors ${flagged ? "text-slate-900" : "text-slate-500 hover:text-slate-900"}`}
            >
              <span className="mr-1.5 flex h-5 w-5 items-center justify-center rounded-sm border border-slate-400">
                <Bookmark className={`h-3.5 w-3.5 ${flagged ? "fill-slate-900 text-slate-900" : "text-slate-400"}`} />
              </span>
              Mark for Review
            </button>
          </div>
          <button
            type="button"
            onClick={onToggleEliminationMode}
            title="Eliminate answer choices"
            className={`flex items-center justify-center rounded-md border-2 p-1 px-1.5 transition-all ${eliminationMode ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}
          >
            <span className="relative">
              <span className="text-[10px] font-black italic tracking-tighter">ABC</span>
              <span className="absolute left-1/2 top-1/2 h-[1.5px] w-full -translate-x-1/2 -translate-y-1/2 rotate-[15deg] bg-current" />
            </span>
          </button>
        </div>

        {/* Decorative SAT rule */}
        <div
          className="mb-8 h-[3px] w-full"
          style={{
            background:
              "repeating-linear-gradient(to right, #b91c1c 0, #b91c1c 48px, transparent 48px, transparent 54px, #ca8a04 54px, #ca8a04 102px, transparent 102px, transparent 108px, #15803d 108px, #15803d 156px, transparent 156px, transparent 162px, #0f172a 162px, #0f172a 210px, transparent 210px, transparent 216px)",
          }}
        />

        {/* Math questions render their stem on the right; RW shows only the prompt. */}
        {question.question_prompt && !isSpr && (
          <SafeHtml
            className="mathjax-process mb-8 font-[Georgia] font-medium leading-relaxed text-slate-900"
            style={{ fontSize: `${16 * zoom * 1.2}px` }}
            html={question.question_prompt.replace(/\n/g, "<br/>")}
          />
        )}
        {isMath && (
          <SafeHtml
            className="mathjax-process mb-8 font-[Georgia] font-medium leading-relaxed text-slate-900"
            style={{ fontSize: `${16 * zoom * 1.2}px` }}
            html={question.question_text?.replace(/\n/g, "<br/>") || ""}
          />
        )}

        {isSpr ? (
          <SprInput value={answer ?? ""} onChange={onSelect} />
        ) : (
          <ChoiceList
            question={question}
            selected={answer}
            eliminated={eliminated}
            eliminationMode={eliminationMode}
            onSelect={onSelect}
            onEliminate={onEliminate}
          />
        )}
      </div>
    </div>
  );
});
