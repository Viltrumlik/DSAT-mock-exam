"use client";

/**
 * Pedagogical Review — /assessments/review/[attemptId]
 *
 * A structurally separate review experience for classroom assessment attempts.
 * Purpose: help students understand their mistakes and consolidate learning.
 *
 * DOMAIN BOUNDARY: This route lives under /assessments/* (classroom domain).
 * It must never import from exam/*, review/*, mock/*, or pastpapers/*, and
 * must never reference SAT-simulation concepts (score bands, performance
 * tiers, benchmarks, etc.).
 *
 * Language guide: "improve", "understand", "learn from" — not "score", "perform",
 * "benchmark", "percentile".
 */

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AuthGuard from "@/components/AuthGuard";
import { assessmentsStudentApi } from "@/features/assessmentsStudent/api";
import type { PedagogicalReviewQuestion, TeacherFeedback } from "@/features/assessmentsStudent/api";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Filter,
  Lightbulb,
  Loader2,
  MessageSquare,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useState, useEffect, useRef } from "react";

// ─── Filter mode ──────────────────────────────────────────────────────────────

type FilterMode = "all" | "incorrect" | "correct" | "unanswered";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function choiceLabel(key: unknown): string {
  if (typeof key === "string") return key.toUpperCase();
  if (typeof key === "number") return String.fromCharCode(65 + key);
  return String(key ?? "");
}

function normalizeAnswer(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val.trim() === "" ? null : val.trim();
  return String(val);
}

function isAnswerMatch(student: unknown, correct: unknown): boolean {
  const s = normalizeAnswer(student);
  const c = normalizeAnswer(correct);
  if (s === null || c === null) return false;
  return s.toLowerCase() === c.toLowerCase();
}

function getQuestionOutcome(q: PedagogicalReviewQuestion): "correct" | "incorrect" | "unanswered" {
  if (q.student_answer === null || q.student_answer === undefined) return "unanswered";
  if (q.is_correct === true) return "correct";
  if (q.is_correct === false) return "incorrect";
  // Fallback if grading not complete
  return isAnswerMatch(q.student_answer, q.correct_answer) ? "correct" : "incorrect";
}

function filterQuestions(questions: PedagogicalReviewQuestion[], mode: FilterMode): PedagogicalReviewQuestion[] {
  if (mode === "all") return questions;
  return questions.filter((q) => {
    const outcome = getQuestionOutcome(q);
    if (mode === "incorrect") return outcome === "incorrect";
    if (mode === "correct") return outcome === "correct";
    if (mode === "unanswered") return outcome === "unanswered";
    return true;
  });
}

// ─── Score ring ───────────────────────────────────────────────────────────────

// ─── Teacher feedback card ────────────────────────────────────────────────────

function TeacherFeedbackCard({ feedback }: { feedback: TeacherFeedback }) {
  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 flex gap-3">
      <MessageSquare className="h-4 w-4 text-primary shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
            {feedback.teacher_name ? `Feedback from ${feedback.teacher_name}` : "Teacher feedback"}
          </p>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {new Date(feedback.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">{feedback.body}</p>
      </div>
    </div>
  );
}

// ─── Score ring ───────────────────────────────────────────────────────────────

function ScoreRing({ percent }: { percent: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const filled = circ * Math.min(1, Math.max(0, percent / 100));
  const color = percent >= 80 ? "#10b981" : percent >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <svg width="96" height="96" viewBox="0 0 96 96" className="shrink-0">
      <circle cx="48" cy="48" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-border" />
      <circle
        cx="48"
        cy="48"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 48 48)"
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      <text x="48" y="53" textAnchor="middle" fill={color} fontSize="18" fontWeight="700">
        {Math.round(percent)}%
      </text>
    </svg>
  );
}

// ─── Choice row ───────────────────────────────────────────────────────────────

type Choice = { key: string; text: string } | string;

function ChoiceRow({
  choice,
  choiceKey,
  isSelected,
  isCorrect: isCorrectChoice,
  reviewMode,
}: {
  choice: Choice;
  choiceKey: string;
  isSelected: boolean;
  isCorrect: boolean;
  reviewMode: boolean;
}) {
  const text = typeof choice === "object" && "text" in choice ? choice.text : String(choice);
  const label = choiceLabel(choiceKey);

  let ring = "border-border bg-card text-foreground";
  if (reviewMode) {
    if (isCorrectChoice) ring = "border-emerald-400 bg-emerald-50 text-emerald-900";
    else if (isSelected && !isCorrectChoice) ring = "border-red-400 bg-red-50 text-red-900";
  } else if (isSelected) {
    ring = "border-primary bg-primary/5 text-foreground";
  }

  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors", ring)}>
      <span
        className={cn(
          "shrink-0 mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
          reviewMode && isCorrectChoice
            ? "bg-emerald-500 text-white"
            : reviewMode && isSelected && !isCorrectChoice
              ? "bg-red-500 text-white"
              : isSelected
                ? "bg-primary text-primary-foreground"
                : "bg-surface-2 text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span className="text-sm leading-relaxed">{text}</span>
      {reviewMode && isCorrectChoice && (
        <CheckCircle2 className="ml-auto shrink-0 mt-0.5 h-4 w-4 text-emerald-500" />
      )}
      {reviewMode && isSelected && !isCorrectChoice && (
        <XCircle className="ml-auto shrink-0 mt-0.5 h-4 w-4 text-red-500" />
      )}
    </div>
  );
}

// ─── Question card ────────────────────────────────────────────────────────────

function QuestionCard({
  q,
  index,
  total,
}: {
  q: PedagogicalReviewQuestion;
  index: number;
  total: number;
}) {
  const outcome = getQuestionOutcome(q);
  const choices: Choice[] = Array.isArray(q.choices) ? q.choices : [];
  const correctKey = normalizeAnswer(q.correct_answer);
  const studentKey = normalizeAnswer(q.student_answer);

  // Determine if this question is multiple choice
  const isMCQ = q.question_type === "multiple_choice";

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Question header bar */}
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-5 py-3 border-b border-border",
          outcome === "correct"
            ? "bg-emerald-50/60"
            : outcome === "incorrect"
              ? "bg-red-50/60"
              : "bg-surface-2/50",
        )}
      >
        <div className="flex items-center gap-2">
          {outcome === "correct" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
          ) : outcome === "incorrect" ? (
            <XCircle className="h-4 w-4 text-red-500 shrink-0" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">
            Question {index + 1} of {total}
          </span>
        </div>
        <span
          className={cn(
            "text-xs font-bold px-2 py-0.5 rounded-lg",
            outcome === "correct"
              ? "bg-emerald-100 text-emerald-700"
              : outcome === "incorrect"
                ? "bg-red-100 text-red-700"
                : "bg-surface-2 text-muted-foreground",
          )}
        >
          {outcome === "correct" ? "Correct" : outcome === "incorrect" ? "Incorrect" : "Not answered"}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* Passage / stimulus (if present) */}
        {q.question_prompt && q.question_prompt.trim().length > 0 && (
          <div className="rounded-xl border-l-4 border-primary/40 bg-surface-2/50 pl-4 pr-4 py-3 text-sm leading-relaxed text-foreground max-h-40 overflow-y-auto sm:max-h-none sm:overflow-visible">
            {q.question_prompt}
          </div>
        )}

        {/* Question stem */}
        <p className="text-sm font-medium leading-relaxed text-foreground">{q.prompt}</p>

        {/* MCQ choices */}
        {isMCQ && choices.length > 0 && (
          <div className="space-y-2">
            {choices.map((choice, ci) => {
              const key = typeof choice === "object" && "key" in choice ? choice.key : String.fromCharCode(65 + ci);
              const isSelected = key === studentKey || String(ci) === studentKey;
              const isCorrectChoice = key === correctKey || String(ci) === correctKey;
              return (
                <ChoiceRow
                  key={key}
                  choice={choice}
                  choiceKey={key}
                  isSelected={isSelected}
                  isCorrect={isCorrectChoice}
                  reviewMode
                />
              );
            })}
          </div>
        )}

        {/* Short answer / numeric */}
        {!isMCQ && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-surface-2/50 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Your answer</p>
              <p className={cn("text-sm font-medium", outcome === "correct" ? "text-emerald-700" : "text-red-700")}>
                {studentKey ?? <span className="text-muted-foreground italic">No answer</span>}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-1">Correct answer</p>
              <p className="text-sm font-medium text-emerald-800">{correctKey ?? "—"}</p>
            </div>
          </div>
        )}

        {/* Explanation */}
        {q.explanation && q.explanation.trim().length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 flex gap-3">
            <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-1">Why this answer works</p>
              <p className="text-sm leading-relaxed text-amber-900">{q.explanation}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function PedagogicalReviewContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const attemptId = Number(params.attemptId);
  const initialQ = Number(searchParams.get("q") ?? "1") - 1; // 0-indexed

  const [filter, setFilter] = useState<FilterMode>("all");
  const [currentIndex, setCurrentIndex] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["pedagogical-review", attemptId],
    queryFn: () => assessmentsStudentApi.pedagogicalReview(attemptId),
    enabled: !isNaN(attemptId) && attemptId > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Retry mutation — starts a new attempt, optionally focused on incorrect questions
  const retryMutation = useMutation({
    mutationFn: async ({ focusIds }: { focusIds?: number[] }) => {
      const assignmentId = data?.meta?.assignment_id;
      if (!assignmentId) throw new Error("Assignment not found");
      const payload: Parameters<typeof assessmentsStudentApi.start>[0] = {
        assignment_id: assignmentId,
      };
      if (focusIds && focusIds.length > 0) {
        payload.focus_question_ids = focusIds;
      }
      const attempt = await assessmentsStudentApi.start(payload);
      return attempt;
    },
    onSuccess: (attempt) => {
      queryClient.invalidateQueries({ queryKey: ["my-assignments"] });
      router.push(`/assessments/attempt/${attempt.id}`);
    },
    onError: () => setRetryError("Could not start retry. Please try again."),
  });

  // Initialise to the question from the ?q= param once data loads
  useEffect(() => {
    if (data && initialQ >= 0 && initialQ < data.questions.length) {
      const filtered = filterQuestions(data.questions, filter);
      // Try to find the same question in filtered view
      const targetQ = data.questions[initialQ];
      if (targetQ) {
        const idx = filtered.findIndex((q) => q.id === targetQ.id);
        setCurrentIndex(idx >= 0 ? idx : 0);
      }
    }
    // Only run once on load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-base font-semibold text-foreground">Review not available</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          This review is only accessible after submitting your work. If you believe this is an error, please contact
          your teacher.
        </p>
        <button
          type="button"
          onClick={() => router.push("/assessments")}
          className="mt-2 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to assignments
        </button>
      </div>
    );
  }

  const { meta, result, questions } = data;

  const filteredQuestions = filterQuestions(questions, filter);
  const safeIndex = Math.min(currentIndex, Math.max(0, filteredQuestions.length - 1));
  const current = filteredQuestions[safeIndex] ?? null;

  // Counts for filter tabs
  const incorrectCount = questions.filter((q) => getQuestionOutcome(q) === "incorrect").length;
  const correctCount = questions.filter((q) => getQuestionOutcome(q) === "correct").length;
  const unansweredCount = questions.filter((q) => getQuestionOutcome(q) === "unanswered").length;

  const handleFilterChange = (mode: FilterMode) => {
    setFilter(mode);
    setCurrentIndex(0);
  };

  const navigate = (delta: number) => {
    setCurrentIndex((prev) => {
      const next = prev + delta;
      if (next < 0 || next >= filteredQuestions.length) return prev;
      return next;
    });
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-dvh bg-background">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto max-w-2xl px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border hover:bg-surface-2 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            {meta.classroom_name && (
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] truncate">
                {meta.classroom_name}
              </p>
            )}
            <p className="text-sm font-bold text-foreground truncate leading-tight">
              {meta.assignment_title ?? meta.set_title ?? "Assignment review"}
            </p>
          </div>
          {meta.set_category && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wide shrink-0">
              <BookOpen className="h-3 w-3" />
              {meta.set_category}
            </span>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        {/* ── Summary card ── */}
        {result ? (
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-5">
              <ScoreRing percent={Number(result.percent)} />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Your results</p>
                <p className="text-2xl font-black text-foreground leading-none">
                  {result.correct_count}
                  <span className="text-base font-semibold text-muted-foreground">/{result.total_questions}</span>
                  <span className="ml-2 text-sm font-semibold text-muted-foreground">correct</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {result.score_points} of {result.max_points} points
                </p>
              </div>
            </div>

            {/* Mini stat pills */}
            <div className="mt-4 flex flex-wrap gap-2">
              {correctCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {correctCount} correct
                </span>
              )}
              {incorrectCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-red-100 px-3 py-1.5 text-xs font-bold text-red-700">
                  <XCircle className="h-3.5 w-3.5" />
                  {incorrectCount} to improve
                </span>
              )}
              {unansweredCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-1.5 text-xs font-bold text-muted-foreground">
                  <Circle className="h-3.5 w-3.5" />
                  {unansweredCount} unanswered
                </span>
              )}
            </div>

            {/* Retry actions */}
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              {incorrectCount > 0 && (
                <button
                  type="button"
                  disabled={retryMutation.isPending}
                  onClick={() => {
                    const incorrectIds = questions
                      .filter((q) => getQuestionOutcome(q) === "incorrect")
                      .map((q) => q.id);
                    retryMutation.mutate({ focusIds: incorrectIds });
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
                >
                  {retryMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Try the {incorrectCount} missed question{incorrectCount !== 1 ? "s" : ""} again
                </button>
              )}
              {data?.meta?.assignment_id && (
                <button
                  type="button"
                  disabled={retryMutation.isPending}
                  onClick={() => retryMutation.mutate({})}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try all questions again
                </button>
              )}
            </div>
            {retryError && <p className="mt-2 text-xs text-red-600">{retryError}</p>}
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card px-5 py-4 flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">Grading in progress — check back shortly.</p>
          </div>
        )}

        {/* ── Teacher feedback ── */}
        {data?.teacher_feedback && <TeacherFeedbackCard feedback={data.teacher_feedback} />}

        {/* ── Filter bar ── */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {(
            [
              { mode: "all" as FilterMode, label: `All (${questions.length})` },
              { mode: "incorrect" as FilterMode, label: `Improve (${incorrectCount})`, disabled: incorrectCount === 0 },
              { mode: "correct" as FilterMode, label: `Correct (${correctCount})`, disabled: correctCount === 0 },
              { mode: "unanswered" as FilterMode, label: `Skipped (${unansweredCount})`, disabled: unansweredCount === 0 },
            ] as { mode: FilterMode; label: string; disabled?: boolean }[]
          ).map(({ mode, label, disabled }) => (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              onClick={() => handleFilterChange(mode)}
              className={cn(
                "shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap",
                filter === mode
                  ? "bg-foreground text-background"
                  : "border border-border bg-card text-muted-foreground hover:bg-surface-2 disabled:opacity-40",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Question navigator (dot row) ── */}
        {filteredQuestions.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {filteredQuestions.map((q, i) => {
              const outcome = getQuestionOutcome(q);
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => {
                    setCurrentIndex(i);
                    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={cn(
                    "shrink-0 rounded-full transition-all",
                    i === safeIndex ? "w-6 h-6" : "w-5 h-5",
                    outcome === "correct"
                      ? i === safeIndex
                        ? "bg-emerald-500"
                        : "bg-emerald-200 hover:bg-emerald-300"
                      : outcome === "incorrect"
                        ? i === safeIndex
                          ? "bg-red-500"
                          : "bg-red-200 hover:bg-red-300"
                        : i === safeIndex
                          ? "bg-muted-foreground"
                          : "bg-border hover:bg-muted-foreground/30",
                  )}
                  aria-label={`Go to question ${i + 1}`}
                />
              );
            })}
          </div>
        )}

        {/* ── Question card ── */}
        <div ref={cardRef}>
          {filteredQuestions.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card px-5 py-12 text-center">
              <p className="text-sm font-semibold text-foreground">No questions in this view</p>
              <button
                type="button"
                onClick={() => handleFilterChange("all")}
                className="mt-3 text-xs text-primary underline underline-offset-2"
              >
                Show all questions
              </button>
            </div>
          ) : current ? (
            <QuestionCard q={current} index={safeIndex} total={filteredQuestions.length} />
          ) : null}
        </div>

        {/* ── Prev / Next navigation ── */}
        {filteredQuestions.length > 1 && (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              disabled={safeIndex === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {safeIndex + 1} / {filteredQuestions.length}
            </span>
            <button
              type="button"
              onClick={() => navigate(1)}
              disabled={safeIndex === filteredQuestions.length - 1}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 disabled:opacity-30 transition-colors"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ── Bottom CTA ── */}
        <div className="rounded-2xl border border-border bg-card px-5 py-4 flex flex-col sm:flex-row items-center gap-3 justify-between">
          <p className="text-sm text-muted-foreground text-center sm:text-left">
            Ready to move on? Head back to your assignments.
          </p>
          <button
            type="button"
            onClick={() => router.push("/assessments")}
            className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            My assignments
          </button>
        </div>

        {/* Bottom safe-area padding for mobile */}
        <div className="h-8 sm:hidden" />
      </div>
    </div>
  );
}

export default function PedagogicalReviewPage() {
  return (
    <AuthGuard>
      <PedagogicalReviewContent />
    </AuthGuard>
  );
}
