"use client";
import { X } from "lucide-react";
import type { ExamQuestion } from "../types";

interface QuestionNavigatorProps {
  open: boolean;
  onClose: () => void;
  title: string;
  questions: ExamQuestion[];
  currentIndex: number;
  answers: Record<string, string>;
  flagged: number[];
  onJump: (index: number) => void;
}

/** Modal grid for jumping between questions (current / unanswered / for-review). */
export function QuestionNavigator({
  open,
  onClose,
  title,
  questions,
  currentIndex,
  answers,
  flagged,
  onJump,
}: QuestionNavigatorProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 pb-24 sm:items-center sm:pb-0" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold tracking-tight text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-4 flex items-center justify-center gap-5 border-b border-slate-100 pb-3 text-xs font-semibold text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-blue-600" /> Current</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-dashed border-slate-400" /> Unanswered</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-red-500" /> For Review</span>
        </div>
        <div className="grid grid-cols-6 gap-3">
          {questions.map((q, i) => {
            const answered = Boolean(answers[q.id]);
            const isCurrent = i === currentIndex;
            const isFlagged = flagged.includes(q.id);
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => {
                  onJump(i);
                  onClose();
                }}
                className={`relative flex h-10 items-center justify-center rounded-md text-sm font-bold transition-all ${
                  isCurrent
                    ? "bg-blue-600 text-white ring-2 ring-blue-300 ring-offset-1"
                    : answered
                      ? "bg-blue-600 text-white"
                      : "border border-dashed border-slate-400 text-slate-600 hover:border-slate-600"
                }`}
              >
                {i + 1}
                {isFlagged && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-sm bg-red-500" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
