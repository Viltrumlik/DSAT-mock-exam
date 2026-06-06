"use client";
import SafeHtml from "@/components/SafeHtml";
import type { ExamQuestion } from "../types";
import { parseOptions } from "../utils/options";
import { resolveImageUrl } from "../utils/image";

interface ChoiceListProps {
  question: ExamQuestion;
  selected: string | undefined;
  eliminated: string[];
  eliminationMode: boolean;
  onSelect: (key: string) => void;
  onEliminate: (key: string) => void;
}

/** Multiple-choice answer list with select + cross-out (eliminate) support. */
export function ChoiceList({ question, selected, eliminated, eliminationMode, onSelect, onEliminate }: ChoiceListProps) {
  const options = parseOptions(question);
  return (
    <div className="w-full space-y-4">
      {options.map(({ key, text, image }) => {
        const isSelected = selected === key;
        const isEliminated = eliminated.includes(key);
        const img = resolveImageUrl(image);
        return (
          <div key={key} className="group relative flex items-center gap-3">
            <button
              type="button"
              onClick={() => !isEliminated && onSelect(key)}
              aria-pressed={isSelected}
              className={`flex min-h-[50px] flex-1 items-center rounded-xl border-2 p-3 px-4 transition-all ${
                isSelected
                  ? "border-blue-600 bg-blue-50/20 outline outline-2 outline-offset-1 outline-blue-600"
                  : isEliminated
                    ? "cursor-not-allowed border-slate-100 opacity-50 grayscale"
                    : "border-slate-300 bg-white hover:border-slate-400"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 font-[Georgia] text-sm font-bold ${
                  isSelected
                    ? "border-blue-600 bg-blue-600 text-white"
                    : isEliminated
                      ? "border-slate-300 text-slate-400"
                      : "border-slate-400 text-slate-800"
                }`}
              >
                {key}
              </span>
              <span className={`ml-4 w-full text-left font-[Georgia] text-[15px] text-slate-800 ${isEliminated ? "line-through decoration-slate-400" : ""}`}>
                {img ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={img} alt={`Option ${key}`} className="max-h-[200px] max-w-full rounded-lg border border-slate-100 object-contain shadow-sm" />
                ) : (
                  <SafeHtml className="mathjax-process w-full" html={text.replace(/\n/g, "<br/>")} />
                )}
              </span>
            </button>

            {eliminationMode && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEliminate(key);
                }}
                title={isEliminated ? "Restore" : "Eliminate"}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 transition-all ${
                  isEliminated
                    ? "border-red-300 bg-red-50 text-red-600 shadow-sm"
                    : "border-slate-200 text-slate-400 hover:border-red-400 hover:text-red-500"
                }`}
              >
                <span className="relative">
                  <span className="text-[11px] font-black">{key}</span>
                  <span className="absolute left-1/2 top-1/2 h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-current" />
                </span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
