"use client";

/**
 * Shared per-question review renderer for classroom assessment attempts.
 * Extracted from /assessments/review/[attemptId] so the same deep-dive can be
 * shown inline on the review page AND inside the pop-up modal on the result page.
 */

import { BookOpen, CheckCircle2, Lightbulb, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { resolveImageUrl } from "@/features/testing-simulation/utils/image";
import { AssessmentText } from "@/lib/assessmentText";
import type { PedagogicalReviewQuestion } from "@/features/assessmentsStudent/api";

export type Outcome = "correct" | "incorrect" | "unanswered";

export function choiceLabel(key: unknown): string {
  if (typeof key === "string") return key.toUpperCase();
  if (typeof key === "number") return String.fromCharCode(65 + key);
  return String(key ?? "");
}

/** Map a choice key (A–D, case-insensitive) to its answer-figure path. */
export function optionImageForKey(q: PedagogicalReviewQuestion, key: string): string | null | undefined {
  switch (String(key).toLowerCase()) {
    case "a": return q.option_a_image;
    case "b": return q.option_b_image;
    case "c": return q.option_c_image;
    case "d": return q.option_d_image;
    default: return undefined;
  }
}

export function normalizeAnswer(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val.trim() === "" ? null : val.trim();
  // A numeric/short-text question may accept several answers — show them all.
  if (Array.isArray(val)) {
    const parts = val.map((x) => String(x).trim()).filter((x) => x !== "");
    return parts.length ? parts.join(", ") : null;
  }
  return String(val);
}

export function isAnswerMatch(student: unknown, correct: unknown): boolean {
  const s = normalizeAnswer(student);
  const c = normalizeAnswer(correct);
  if (s === null || c === null) return false;
  return s.toLowerCase() === c.toLowerCase();
}

export function getQuestionOutcome(q: PedagogicalReviewQuestion): Outcome {
  if (q.student_answer === null || q.student_answer === undefined) return "unanswered";
  if (q.is_correct === true) return "correct";
  if (q.is_correct === false) return "incorrect";
  return isAnswerMatch(q.student_answer, q.correct_answer) ? "correct" : "incorrect";
}

export const OUTCOME_META: Record<Outcome, { label: string; badge: string; dot: string }> = {
  correct: {
    label: "Correct",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  incorrect: {
    label: "Incorrect",
    badge: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  unanswered: {
    label: "Not answered",
    badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300",
    dot: "bg-amber-400",
  },
};

// ─── Choice row (mirrors the exam review modal's option styling) ─────────────

function ChoiceRow({
  choiceKey, text, isSelected, isCorrect, showAnswers, optionImage,
}: {
  choiceKey: string; text: string; isSelected: boolean; isCorrect: boolean; showAnswers: boolean; optionImage?: string | null;
}) {
  const label = choiceLabel(choiceKey);
  const imgSrc = resolveImageUrl(optionImage);

  let box = "border-border bg-card text-foreground";
  let badge = "border-border text-muted-foreground";
  let icon: React.ReactNode = null;
  if (showAnswers && isCorrect) {
    // Reveal the correct choice only when answers are shown.
    box = "border-emerald-500 bg-emerald-50 text-emerald-900 font-bold dark:bg-emerald-500/10 dark:text-emerald-200";
    badge = "bg-emerald-500 border-emerald-500 text-white";
    icon = <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-emerald-600" />;
  } else if (isSelected && showAnswers && !isCorrect) {
    box = "border-rose-400 bg-rose-50 text-rose-900 font-bold dark:bg-rose-500/10 dark:text-rose-200";
    badge = "bg-rose-500 border-rose-500 text-white";
    icon = <XCircle className="ml-auto h-4 w-4 shrink-0 text-rose-600" />;
  } else if (isSelected) {
    // Answers hidden — mark the student's own pick without revealing correctness.
    box = "border-border bg-surface-2 text-foreground font-bold";
    badge = "bg-primary border-primary text-primary-foreground";
  }

  return (
    <div className={cn("flex items-center gap-4 rounded-xl border-2 p-4 transition-all", box)}>
      <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 text-xs font-bold", badge)}>
        {label}
      </div>
      <div className="min-w-0 flex-1 font-[Georgia]">
        {imgSrc ? (
          <img src={imgSrc} alt={`Option ${label}`} className="max-h-[160px] max-w-full rounded-lg border border-border bg-card object-contain" />
        ) : (
          <AssessmentText text={text} preserveNewlines className="text-sm leading-relaxed" />
        )}
      </div>
      {icon}
    </div>
  );
}

// ─── Question deep-dive ──────────────────────────────────────────────────────

/**
 * Two-pane per-question review body (mirrors the pastpaper exam review):
 * LEFT = question content (figure + stem), RIGHT = stimulus + answer analysis
 * + explanation. Correct-answer reveals are gated on `showAnswers`. The
 * surrounding chrome (header, Report, prev/next) lives in QuestionReviewModal.
 */
export function QuestionDeepDive({ q, showAnswers = true }: { q: PedagogicalReviewQuestion; showAnswers?: boolean }) {
  const outcome = getQuestionOutcome(q);
  const choices = Array.isArray(q.choices) ? q.choices : [];
  const correctKey = normalizeAnswer(q.correct_answer);
  const studentKey = normalizeAnswer(q.student_answer);
  const isMCQ = q.question_type === "multiple_choice";
  const figure = resolveImageUrl(q.question_image);

  return (
    <div className="flex h-full flex-col divide-y divide-border md:flex-row md:divide-x md:divide-y-0">
      {/* LEFT — question content: figure + stem */}
      <div className="overflow-y-auto p-6 sm:p-8 md:w-3/5">
        {figure ? (
          <div className="mb-6 flex justify-center overflow-hidden rounded-2xl border border-border bg-surface-2">
            <img src={figure} alt="Question figure" className="max-h-[450px] max-w-full object-contain p-4" />
          </div>
        ) : null}
        <AssessmentText
          text={q.prompt}
          block
          className="rounded-2xl border border-border bg-surface-2 p-6 font-[Georgia] text-base font-medium leading-relaxed text-foreground"
        />
      </div>

      {/* RIGHT — stimulus + answer analysis + explanation */}
      <div className="space-y-7 overflow-y-auto bg-surface-2/30 p-6 sm:p-8 md:w-2/5">
        {/* stimulus / passage */}
        {q.question_prompt && q.question_prompt.trim().length > 0 ? (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
              <BookOpen className="h-3 w-3" /> Question prompt
            </h3>
            <AssessmentText
              text={q.question_prompt}
              block
              className="border-l-4 border-primary/50 py-1 pl-5 pr-1 font-[Georgia] text-base font-medium leading-relaxed text-foreground"
            />
          </div>
        ) : null}

        {/* answer analysis */}
        <div>
          <h3 className="mb-4 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">Answer analysis</h3>

          {isMCQ && choices.length > 0 ? (
            <div className="space-y-3">
              {choices.map((choice: unknown, ci: number) => {
                const key = typeof choice === "object" && choice !== null && "key" in choice
                  ? String((choice as { key: unknown }).key)
                  : String.fromCharCode(65 + ci);
                const text = typeof choice === "object" && choice !== null && "text" in choice
                  ? String((choice as { text: unknown }).text)
                  : String(choice);
                const isSelected = key === studentKey || String(ci) === studentKey;
                const isCorrectChoice = key === correctKey || String(ci) === correctKey;
                return (
                  <ChoiceRow
                    key={key}
                    choiceKey={key}
                    text={text}
                    isSelected={isSelected}
                    isCorrect={isCorrectChoice}
                    showAnswers={showAnswers}
                    optionImage={optionImageForKey(q, key)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <div className={cn(
                "rounded-xl border-2 p-5",
                showAnswers && outcome === "correct" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                  : showAnswers && outcome === "incorrect" ? "border-rose-400 bg-rose-50 dark:bg-rose-500/10"
                    : "border-border bg-surface-2",
              )}>
                <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Your answer</p>
                {studentKey ? (
                  <AssessmentText text={studentKey} className={cn("text-lg font-bold",
                    showAnswers && outcome === "correct" ? "text-emerald-700 dark:text-emerald-300"
                      : showAnswers && outcome === "incorrect" ? "text-rose-700 dark:text-rose-300" : "text-foreground")} />
                ) : (
                  <p className="text-lg font-bold italic text-muted-foreground">Omitted</p>
                )}
              </div>
              {showAnswers ? (
                <div className="rounded-xl border-2 border-foreground bg-foreground p-5 text-background shadow-lg">
                  <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider opacity-70">Correct answer</p>
                  {correctKey ? <AssessmentText text={correctKey} className="text-lg font-bold" /> : <p className="text-lg font-bold">—</p>}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* explanation — only when answers are revealed */}
        {showAnswers && q.explanation && q.explanation.trim().length > 0 ? (
          <div className="rounded-2xl border border-primary/15 bg-primary/5 p-6">
            <h4 className="mb-3 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-primary">
              <Lightbulb className="h-3.5 w-3.5" /> Why this answer works
            </h4>
            <AssessmentText text={q.explanation} block className="font-[Georgia] text-sm leading-relaxed text-foreground" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
