"use client";

/**
 * Pedagogical Review — /assessments/review/[attemptId]
 *
 * A structurally separate review experience for classroom assessment attempts.
 * Purpose: help students understand their mistakes and consolidate learning.
 *
 * DOMAIN BOUNDARY: This route lives under /assessments/* (classroom domain).
 * Language guide: "improve", "understand", "learn from".
 */

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AuthGuard from "@/components/AuthGuard";
import { assessmentsStudentApi } from "@/features/assessmentsStudent/api";
import type { PedagogicalReviewQuestion, TeacherFeedback } from "@/features/assessmentsStudent/api";
import {
  ArrowLeft, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Circle, Filter, Lightbulb, MessageSquare, RefreshCw, XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { AssessmentText, HighlightedText } from "@/lib/assessmentText";
import { readHighlightStore, type HighlightStore } from "@/features/assessments/attemptHighlightStorage";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, Badge, Button, IconButton, ProgressRing, EmptyState, Spinner } from "@/components/ui";

// ─── Filter mode ──────────────────────────────────────────────────────────────

type FilterMode = "all" | "incorrect" | "correct" | "unanswered";

// ─── Helpers (business logic preserved verbatim) ─────────────────────────────

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

// ─── Teacher feedback ────────────────────────────────────────────────────────

function TeacherFeedbackCard({ feedback }: { feedback: TeacherFeedback }) {
  return (
    <Card className="border-primary/20 bg-primary-soft">
      <CardContent className="flex gap-3">
        <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="ds-overline text-primary">{feedback.teacher_name ? `Feedback from ${feedback.teacher_name}` : "Teacher feedback"}</p>
            <span className="shrink-0 text-[10px] text-muted-foreground">{new Date(feedback.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{feedback.body}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Choice row ───────────────────────────────────────────────────────────────

type Choice = { key: string; text: string } | string;

function ChoiceRow({
  choice, choiceKey, isSelected, isCorrect: isCorrectChoice, reviewMode,
}: {
  choice: Choice; choiceKey: string; isSelected: boolean; isCorrect: boolean; reviewMode: boolean;
}) {
  const text = typeof choice === "object" && "text" in choice ? choice.text : String(choice);
  const label = choiceLabel(choiceKey);

  let ring = "border-border bg-card text-foreground";
  if (reviewMode) {
    if (isCorrectChoice) ring = "border-success/50 bg-success-soft text-success-foreground";
    else if (isSelected && !isCorrectChoice) ring = "border-danger/50 bg-danger-soft text-danger-foreground";
  } else if (isSelected) {
    ring = "border-primary bg-primary-soft text-foreground";
  }

  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors", ring)}>
      <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
        reviewMode && isCorrectChoice ? "bg-success text-white"
          : reviewMode && isSelected && !isCorrectChoice ? "bg-danger text-white"
            : isSelected ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground")}>
        {label}
      </span>
      <AssessmentText text={text} className="text-sm leading-relaxed" />
      {reviewMode && isCorrectChoice ? <CheckCircle2 className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-success" /> : null}
      {reviewMode && isSelected && !isCorrectChoice ? <XCircle className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-danger" /> : null}
    </div>
  );
}

// ─── Question card ────────────────────────────────────────────────────────────

function QuestionCard({
  q, index, total, questionHighlight, passageHighlight,
}: {
  q: PedagogicalReviewQuestion; index: number; total: number;
  questionHighlight?: string | null; passageHighlight?: string | null;
}) {
  const outcome = getQuestionOutcome(q);
  const choices: Choice[] = Array.isArray(q.choices) ? q.choices : [];
  const correctKey = normalizeAnswer(q.correct_answer);
  const studentKey = normalizeAnswer(q.student_answer);
  const isMCQ = q.question_type === "multiple_choice";

  const outcomeVariant = outcome === "correct" ? "success" : outcome === "incorrect" ? "danger" : "neutral";
  const headerTint = outcome === "correct" ? "bg-success-soft" : outcome === "incorrect" ? "bg-danger-soft" : "bg-surface-2";

  return (
    <Card>
      <div className={cn("flex items-center justify-between gap-3 border-b border-border px-5 py-3", headerTint)}>
        <div className="flex items-center gap-2">
          {outcome === "correct" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : outcome === "incorrect" ? <XCircle className="h-4 w-4 shrink-0 text-danger" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="ds-overline">Question {index + 1} of {total}</span>
        </div>
        <Badge variant={outcomeVariant}>{outcome === "correct" ? "Correct" : outcome === "incorrect" ? "Incorrect" : "Not answered"}</Badge>
      </div>

      <CardContent className="space-y-4">
        {q.question_prompt && q.question_prompt.trim().length > 0 ? (
          passageHighlight ? (
            <HighlightedText html={passageHighlight} className="max-h-40 overflow-y-auto rounded-xl border-l-4 border-primary/40 bg-surface-2 py-3 pl-4 pr-4 text-sm leading-relaxed text-foreground sm:max-h-none sm:overflow-visible" />
          ) : (
            <AssessmentText text={q.question_prompt} block className="max-h-40 overflow-y-auto rounded-xl border-l-4 border-primary/40 bg-surface-2 py-3 pl-4 pr-4 text-sm leading-relaxed text-foreground sm:max-h-none sm:overflow-visible" />
          )
        ) : null}

        {questionHighlight ? (
          <HighlightedText html={questionHighlight} className="text-sm font-medium leading-relaxed text-foreground" />
        ) : (
          <AssessmentText text={q.prompt} block className="text-sm font-medium leading-relaxed text-foreground" />
        )}

        {isMCQ && choices.length > 0 ? (
          <div className="space-y-2">
            {choices.map((choice, ci) => {
              const key = typeof choice === "object" && "key" in choice ? choice.key : String.fromCharCode(65 + ci);
              const isSelected = key === studentKey || String(ci) === studentKey;
              const isCorrectChoice = key === correctKey || String(ci) === correctKey;
              return <ChoiceRow key={key} choice={choice} choiceKey={key} isSelected={isSelected} isCorrect={isCorrectChoice} reviewMode />;
            })}
          </div>
        ) : null}

        {!isMCQ ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
              <p className="ds-overline mb-1">Your answer</p>
              {studentKey ? (
                <AssessmentText text={studentKey} className={cn("text-sm font-medium", outcome === "correct" ? "text-success-foreground" : "text-danger-foreground")} />
              ) : (
                <p className="text-sm font-medium"><span className="italic text-muted-foreground">No answer</span></p>
              )}
            </div>
            <div className="rounded-xl border border-success/30 bg-success-soft px-4 py-3">
              <p className="ds-overline mb-1 text-success-foreground">Correct answer</p>
              {correctKey ? <AssessmentText text={correctKey} className="text-sm font-medium text-success-foreground" /> : <p className="text-sm font-medium text-success-foreground">—</p>}
            </div>
          </div>
        ) : null}

        {q.explanation && q.explanation.trim().length > 0 ? (
          <div className="flex gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <p className="ds-overline mb-1 text-warning-foreground">Why this answer works</p>
              <AssessmentText text={q.explanation} block className="text-sm leading-relaxed text-warning-foreground" />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function PedagogicalReviewContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const attemptId = Number(params.attemptId);
  const initialQ = Number(searchParams.get("q") ?? "1") - 1;

  const [filter, setFilter] = useState<FilterMode>("all");
  const [currentIndex, setCurrentIndex] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const [highlights, setHighlights] = useState<HighlightStore | null>(null);
  useEffect(() => {
    if (!isNaN(attemptId) && attemptId > 0) setHighlights(readHighlightStore(attemptId));
  }, [attemptId]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["pedagogical-review", attemptId],
    queryFn: () => assessmentsStudentApi.pedagogicalReview(attemptId),
    enabled: !isNaN(attemptId) && attemptId > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const retryMutation = useMutation({
    mutationFn: async ({ focusIds }: { focusIds?: number[] }) => {
      const assignmentId = data?.meta?.assignment_id;
      if (!assignmentId) throw new Error("Assignment not found");
      const payload: Parameters<typeof assessmentsStudentApi.start>[0] = { assignment_id: assignmentId };
      if (focusIds && focusIds.length > 0) payload.focus_question_ids = focusIds;
      const attempt = await assessmentsStudentApi.start(payload);
      return attempt;
    },
    onSuccess: (attempt) => {
      queryClient.invalidateQueries({ queryKey: ["my-assignments"] });
      router.push(`/assessments/attempt/${attempt.id}`);
    },
    onError: () => setRetryError("Could not start retry. Please try again."),
  });

  useEffect(() => {
    if (data && initialQ >= 0 && initialQ < data.questions.length) {
      const filtered = filterQuestions(data.questions, filter);
      const targetQ = data.questions[initialQ];
      if (targetQ) {
        const idx = filtered.findIndex((q) => q.id === targetQ.id);
        setCurrentIndex(idx >= 0 ? idx : 0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (isLoading) {
    return <div className="flex h-dvh items-center justify-center"><Spinner className="h-6 w-6 text-muted-foreground" /></div>;
  }

  if (isError || !data) {
    return (
      <div className="flex h-dvh items-center justify-center px-6">
        <EmptyState
          title="Review not available"
          description="This review is only accessible after submitting your work. If you believe this is an error, please contact your teacher."
          action={<Button leftIcon={<ArrowLeft />} onClick={() => router.push("/assessments")}>Back to assignments</Button>}
        />
      </div>
    );
  }

  const { meta, result, questions } = data;
  const filteredQuestions = filterQuestions(questions, filter);
  const safeIndex = Math.min(currentIndex, Math.max(0, filteredQuestions.length - 1));
  const current = filteredQuestions[safeIndex] ?? null;

  const incorrectCount = questions.filter((q) => getQuestionOutcome(q) === "incorrect").length;
  const correctCount = questions.filter((q) => getQuestionOutcome(q) === "correct").length;
  const unansweredCount = questions.filter((q) => getQuestionOutcome(q) === "unanswered").length;

  const handleFilterChange = (mode: FilterMode) => { setFilter(mode); setCurrentIndex(0); };

  const navigate = (delta: number) => {
    setCurrentIndex((prev) => {
      const next = prev + delta;
      if (next < 0 || next >= filteredQuestions.length) return prev;
      return next;
    });
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const pct = result ? Number(result.percent) : 0;
  const ringColor = pct >= 75 ? "text-success" : pct >= 50 ? "text-primary" : "text-warning";

  return (
    <div className="ds-app min-h-dvh bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <IconButton variant="default" size="sm" aria-label="Go back" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" /></IconButton>
          <div className="min-w-0 flex-1">
            {meta.classroom_name ? <p className="ds-overline truncate">{meta.classroom_name}</p> : null}
            <p className="truncate text-sm font-bold leading-tight text-foreground">{meta.assignment_title ?? meta.set_title ?? "Assignment review"}</p>
          </div>
          {meta.set_category ? <span className="hidden shrink-0 sm:inline-flex"><Badge variant="neutral"><BookOpen className="h-3 w-3" /> {meta.set_category}</Badge></span> : null}
        </div>
      </header>

      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
        {/* Summary */}
        {result ? (
          <Card>
            <CardContent>
              <div className="flex items-center gap-5">
                <ProgressRing value={pct} size={96} strokeWidth={8} color={ringColor} showLabel={false}>
                  <span className={cn("ds-num text-lg font-extrabold", ringColor)}>{Math.round(pct)}%</span>
                </ProgressRing>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="ds-overline">Your results</p>
                  <p className="ds-num text-2xl font-extrabold leading-none text-foreground">
                    {result.correct_count}<span className="text-base font-semibold text-muted-foreground">/{result.total_questions}</span>
                    <span className="ml-2 text-sm font-semibold text-muted-foreground">correct</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{result.score_points} of {result.max_points} points</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {correctCount > 0 ? <Badge variant="success"><CheckCircle2 className="h-3.5 w-3.5" /> {correctCount} correct</Badge> : null}
                {incorrectCount > 0 ? <Badge variant="danger"><XCircle className="h-3.5 w-3.5" /> {incorrectCount} to improve</Badge> : null}
                {unansweredCount > 0 ? <Badge variant="neutral"><Circle className="h-3.5 w-3.5" /> {unansweredCount} unanswered</Badge> : null}
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                {incorrectCount > 0 ? (
                  <Button
                    variant="secondary" fullWidth loading={retryMutation.isPending} leftIcon={<RefreshCw />}
                    onClick={() => {
                      const incorrectIds = questions.filter((q) => getQuestionOutcome(q) === "incorrect").map((q) => q.id);
                      retryMutation.mutate({ focusIds: incorrectIds });
                    }}
                  >
                    Try the {incorrectCount} missed question{incorrectCount !== 1 ? "s" : ""} again
                  </Button>
                ) : null}
                {data?.meta?.assignment_id ? (
                  <Button variant="secondary" fullWidth leftIcon={<RefreshCw />} disabled={retryMutation.isPending} onClick={() => retryMutation.mutate({})}>Try all questions again</Button>
                ) : null}
              </div>
              {retryError ? <p className="mt-2 text-xs text-danger-foreground">{retryError}</p> : null}
            </CardContent>
          </Card>
        ) : (
          <Card><CardContent className="flex items-center gap-3"><Spinner className="h-4 w-4 text-muted-foreground" /><p className="text-sm text-muted-foreground">Grading in progress — check back shortly.</p></CardContent></Card>
        )}

        {data?.teacher_feedback ? <TeacherFeedbackCard feedback={data.teacher_feedback} /> : null}

        {/* Filter bar */}
        <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
          <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {([
            { mode: "all" as FilterMode, label: `All (${questions.length})` },
            { mode: "incorrect" as FilterMode, label: `Improve (${incorrectCount})`, disabled: incorrectCount === 0 },
            { mode: "correct" as FilterMode, label: `Correct (${correctCount})`, disabled: correctCount === 0 },
            { mode: "unanswered" as FilterMode, label: `Skipped (${unansweredCount})`, disabled: unansweredCount === 0 },
          ] as { mode: FilterMode; label: string; disabled?: boolean }[]).map(({ mode, label, disabled }) => (
            <button key={mode} type="button" disabled={disabled} onClick={() => handleFilterChange(mode)}
              className={cn("ds-ring shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
                filter === mode ? "border-primary/30 bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground hover:bg-surface-2 disabled:opacity-40")}>
              {label}
            </button>
          ))}
        </div>

        {/* Dot navigator */}
        {filteredQuestions.length > 0 ? (
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {filteredQuestions.map((q, i) => {
              const outcome = getQuestionOutcome(q);
              const active = i === safeIndex;
              return (
                <button key={q.id} type="button" aria-label={`Go to question ${i + 1}`}
                  onClick={() => { setCurrentIndex(i); cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                  className={cn("ds-ring shrink-0 rounded-full transition-all", active ? "h-6 w-6" : "h-5 w-5",
                    outcome === "correct" ? (active ? "bg-success" : "bg-success/40 hover:bg-success/60")
                      : outcome === "incorrect" ? (active ? "bg-danger" : "bg-danger/40 hover:bg-danger/60")
                        : (active ? "bg-muted-foreground" : "bg-border hover:bg-muted-foreground/40"))}
                />
              );
            })}
          </div>
        ) : null}

        {/* Question card */}
        <div ref={cardRef}>
          {filteredQuestions.length === 0 ? (
            <EmptyState compact title="No questions in this view" action={<Button variant="ghost" size="sm" onClick={() => handleFilterChange("all")}>Show all questions</Button>} />
          ) : current ? (
            <QuestionCard q={current} index={safeIndex} total={filteredQuestions.length} questionHighlight={highlights?.question[current.id] ?? null} passageHighlight={highlights?.passage[current.id] ?? null} />
          ) : null}
        </div>

        {/* Prev / Next */}
        {filteredQuestions.length > 1 ? (
          <div className="flex items-center justify-between gap-3">
            <Button variant="secondary" leftIcon={<ChevronLeft />} disabled={safeIndex === 0} onClick={() => navigate(-1)}>Previous</Button>
            <span className="ds-num text-xs text-muted-foreground">{safeIndex + 1} / {filteredQuestions.length}</span>
            <Button variant="secondary" rightIcon={<ChevronRight />} disabled={safeIndex === filteredQuestions.length - 1} onClick={() => navigate(1)}>Next</Button>
          </div>
        ) : null}

        {/* Bottom CTA */}
        <Card variant="soft">
          <CardContent className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-center text-sm text-muted-foreground sm:text-left">Ready to move on? Head back to your assignments.</p>
            <Button className="shrink-0" leftIcon={<ArrowLeft />} onClick={() => router.push("/assessments")}>My assignments</Button>
          </CardContent>
        </Card>

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
