"use client";

import { CheckCircle2 } from "lucide-react";

import { AssessmentText } from "@/lib/assessmentText";
import { resolveImageUrl } from "@/features/testing-simulation/utils/image";
import { cn } from "@/lib/cn";

import type { ReviewQuestion } from "./types";

/** Read-only, answer-revealing render of one test's questions. No timer, no attempt. */
export function ReviewQuestionList({ questions }: { questions: ReviewQuestion[] }) {
  if (questions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface-2/30 py-16 text-center text-sm text-muted-foreground">
        This item has no questions yet.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {questions.map((q, idx) => (
        <ReviewQuestionCard key={q.key} q={q} number={idx + 1} />
      ))}
    </div>
  );
}

function ReviewQuestionCard({ q, number }: { q: ReviewQuestion; number: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border bg-surface-2/40 px-4 py-2.5">
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-bold text-primary">
          {number}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {q.isChoice ? "Multiple choice" : "Student response"}
        </span>
        {typeof q.points === "number" && q.points > 0 && (
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {q.points} {q.points === 1 ? "point" : "points"}
          </span>
        )}
      </div>

      <div className="space-y-4 p-5">
        {/* Main content first (Reading: passage · Math: the question). */}
        {q.prompt.trim() && (
          <AssessmentText text={q.prompt} block className="text-sm font-medium leading-relaxed text-foreground" />
        )}

        {resolveImageUrl(q.image) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resolveImageUrl(q.image)} alt="" className="max-h-96 max-w-full rounded-lg border border-border" />
        )}

        {/* Secondary prompt, right above the choices. */}
        {q.questionPrompt?.trim() && (
          <AssessmentText text={q.questionPrompt} block className="text-sm leading-relaxed text-foreground" />
        )}

        {q.isChoice ? (
          <div className="space-y-2">
            {q.choices.map((c) => {
              const isCorrect = q.correctIds.includes(c.id);
              return (
                <div
                  key={c.id}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border px-3 py-2.5",
                    isCorrect
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                      : "border-border bg-surface-2/40 text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      isCorrect
                        ? "bg-emerald-500 text-white"
                        : "border border-border bg-background text-muted-foreground",
                    )}
                  >
                    {c.id}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                    {c.text.trim() ? (
                      <AssessmentText text={c.text} preserveNewlines className="text-sm leading-relaxed" />
                    ) : (
                      !c.image && <em className="text-sm opacity-40">empty</em>
                    )}
                    {resolveImageUrl(c.image) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={resolveImageUrl(c.image)} alt="" className="max-h-48 max-w-full rounded-md border border-border" />
                    )}
                  </div>
                  {isCorrect && <CheckCircle2 className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Correct answer</span>
              <div className="font-semibold">
                <AssessmentText text={q.correctText} className="text-sm" />
              </div>
            </div>
          </div>
        )}

        {q.explanation?.trim() && (
          <div className="rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-primary">Explanation</p>
            <AssessmentText text={q.explanation} block className="text-sm leading-relaxed text-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}
