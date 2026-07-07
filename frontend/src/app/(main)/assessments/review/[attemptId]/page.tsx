"use client";

/**
 * Pedagogical Review — /assessments/review/[attemptId]
 *
 * Per-question review for classroom assessment attempts: helps students
 * understand their mistakes and consolidate learning. Visual language matches
 * the redesigned exam review (/review/[attemptId]) and result summary —
 * gradient score hero, stat grid, emerald/rose answer analysis, cr-* motion.
 *
 * DOMAIN BOUNDARY: lives under /assessments/* (classroom domain) and renders
 * inside the student app shell. Language guide: "improve", "understand".
 */

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import AuthGuard from "@/components/AuthGuard";
import { assessmentsStudentApi } from "@/features/assessmentsStudent/api";
import type { PedagogicalReviewQuestion, TeacherFeedback } from "@/features/assessmentsStudent/api";
import {
  ArrowLeft, BookOpen, CheckCircle2, ChevronRight, GraduationCap,
  Lightbulb, MessageSquare, RefreshCw, XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { resolveImageUrl } from "@/features/testing-simulation/utils/image";
import { AssessmentText } from "@/lib/assessmentText";
import { spawnRipple } from "@/features/classroom/ui/ripple";
import { Spinner } from "@/components/ui";

const JAKARTA = "var(--font-plus-jakarta), system-ui, sans-serif";

// ─── Filter mode ──────────────────────────────────────────────────────────────

type FilterMode = "all" | "incorrect" | "correct" | "unanswered";
type Outcome = "correct" | "incorrect" | "unanswered";

// ─── Business-logic helpers (preserved verbatim) ─────────────────────────────

function choiceLabel(key: unknown): string {
  if (typeof key === "string") return key.toUpperCase();
  if (typeof key === "number") return String.fromCharCode(65 + key);
  return String(key ?? "");
}

/** Map a choice key (A–D, case-insensitive) to its answer-figure path. */
function optionImageForKey(q: PedagogicalReviewQuestion, key: string): string | null | undefined {
  switch (String(key).toLowerCase()) {
    case "a": return q.option_a_image;
    case "b": return q.option_b_image;
    case "c": return q.option_c_image;
    case "d": return q.option_d_image;
    default: return undefined;
  }
}

function normalizeAnswer(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string") return val.trim() === "" ? null : val.trim();
  // A numeric/short-text question may accept several answers — show them all.
  if (Array.isArray(val)) {
    const parts = val.map((x) => String(x).trim()).filter((x) => x !== "");
    return parts.length ? parts.join(", ") : null;
  }
  return String(val);
}

function isAnswerMatch(student: unknown, correct: unknown): boolean {
  const s = normalizeAnswer(student);
  const c = normalizeAnswer(correct);
  if (s === null || c === null) return false;
  return s.toLowerCase() === c.toLowerCase();
}

function getQuestionOutcome(q: PedagogicalReviewQuestion): Outcome {
  if (q.student_answer === null || q.student_answer === undefined) return "unanswered";
  if (q.is_correct === true) return "correct";
  if (q.is_correct === false) return "incorrect";
  return isAnswerMatch(q.student_answer, q.correct_answer) ? "correct" : "incorrect";
}

function filterQuestions(questions: PedagogicalReviewQuestion[], mode: FilterMode): PedagogicalReviewQuestion[] {
  if (mode === "all") return questions;
  return questions.filter((q) => getQuestionOutcome(q) === mode);
}

const OUTCOME_META: Record<Outcome, { label: string; badge: string; dot: string }> = {
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

// ─── Teacher feedback ────────────────────────────────────────────────────────

function TeacherFeedbackCard({ feedback }: { feedback: TeacherFeedback }) {
  return (
    <div className="rounded-3xl border border-primary/20 bg-primary/5 p-6 shadow-sm">
      <div className="flex gap-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-card text-primary">
          <MessageSquare className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-[11px] font-extrabold uppercase tracking-widest text-primary">
              {feedback.teacher_name ? `Feedback from ${feedback.teacher_name}` : "Teacher feedback"}
            </p>
            <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">
              {new Date(feedback.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{feedback.body}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Choice row (mirrors the exam review modal's option styling) ─────────────

function ChoiceRow({
  choiceKey, text, isSelected, isCorrect, optionImage,
}: {
  choiceKey: string; text: string; isSelected: boolean; isCorrect: boolean; optionImage?: string | null;
}) {
  const label = choiceLabel(choiceKey);
  const imgSrc = resolveImageUrl(optionImage);

  let box = "border-border bg-card text-foreground";
  let badge = "border-border text-muted-foreground";
  let icon: React.ReactNode = null;
  if (isCorrect) {
    box = "border-emerald-500 bg-emerald-50 text-emerald-900 font-bold dark:bg-emerald-500/10 dark:text-emerald-200";
    badge = "bg-emerald-500 border-emerald-500 text-white";
    icon = <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-emerald-600" />;
  } else if (isSelected) {
    box = "border-rose-400 bg-rose-50 text-rose-900 font-bold dark:bg-rose-500/10 dark:text-rose-200";
    badge = "bg-rose-500 border-rose-500 text-white";
    icon = <XCircle className="ml-auto h-4 w-4 shrink-0 text-rose-600" />;
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

function QuestionDeepDive({ q, index, total }: { q: PedagogicalReviewQuestion; index: number; total: number }) {
  const outcome = getQuestionOutcome(q);
  const meta = OUTCOME_META[outcome];
  const choices = Array.isArray(q.choices) ? q.choices : [];
  const correctKey = normalizeAnswer(q.correct_answer);
  const studentKey = normalizeAnswer(q.student_answer);
  const isMCQ = q.question_type === "multiple_choice";
  const figure = resolveImageUrl(q.question_image);

  return (
    <div className="cr-rowin2 overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center gap-2.5">
          {outcome === "correct" ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            : outcome === "incorrect" ? <XCircle className="h-5 w-5 text-rose-500" />
              : <BookOpen className="h-5 w-5 text-amber-500" />}
          <span className="text-sm font-extrabold text-foreground">Question {index + 1}</span>
          <span className="text-xs font-semibold text-muted-foreground">of {total}</span>
        </div>
        <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider", meta.badge)}>
          {meta.label}
        </span>
      </div>

      <div className="space-y-5 p-6 sm:p-7">
        {/* passage / stimulus */}
        {q.question_prompt && q.question_prompt.trim().length > 0 ? (
          <AssessmentText
            text={q.question_prompt}
            block
            className="border-l-4 border-primary/50 bg-surface-2/50 py-2 pl-5 pr-4 font-[Georgia] text-base font-medium leading-relaxed text-foreground"
          />
        ) : null}

        {/* figure (above the stem) */}
        {figure ? (
          <div className="flex justify-center overflow-hidden rounded-2xl border border-border bg-surface-2">
            <img src={figure} alt="Question figure" className="max-h-[420px] max-w-full object-contain p-4" />
          </div>
        ) : null}

        {/* question stem */}
        <AssessmentText
          text={q.prompt}
          block
          className="rounded-2xl border border-border bg-surface-2 p-6 font-[Georgia] text-base font-medium leading-relaxed text-foreground"
        />

        {/* answer analysis */}
        <div>
          <h3 className="mb-3 text-[11px] font-extrabold uppercase tracking-widest text-muted-foreground">Answer analysis</h3>

          {isMCQ && choices.length > 0 ? (
            <div className="space-y-2.5">
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
                    optionImage={optionImageForKey(q, key)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className={cn(
                "rounded-xl border-2 p-5",
                outcome === "correct" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                  : outcome === "incorrect" ? "border-rose-400 bg-rose-50 dark:bg-rose-500/10"
                    : "border-border bg-surface-2",
              )}>
                <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Your answer</p>
                {studentKey ? (
                  <AssessmentText text={studentKey} className={cn("text-lg font-bold",
                    outcome === "correct" ? "text-emerald-700 dark:text-emerald-300" : outcome === "incorrect" ? "text-rose-700 dark:text-rose-300" : "text-foreground")} />
                ) : (
                  <p className="text-lg font-bold italic text-muted-foreground">Omitted</p>
                )}
              </div>
              <div className="rounded-xl border-2 border-foreground bg-foreground p-5 text-background shadow-lg">
                <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider opacity-70">Correct answer</p>
                {correctKey ? <AssessmentText text={correctKey} className="text-lg font-bold" /> : <p className="text-lg font-bold">—</p>}
              </div>
            </div>
          )}
        </div>

        {/* explanation */}
        {q.explanation && q.explanation.trim().length > 0 ? (
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
      return assessmentsStudentApi.start(payload);
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
    return <div className="flex min-h-[60vh] items-center justify-center"><Spinner className="h-7 w-7 text-primary" /></div>;
  }

  if (isError || !data) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center" style={{ fontFamily: JAKARTA }}>
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface-2 text-muted-foreground">
          <GraduationCap className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-xl font-extrabold text-foreground">Review not available</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This review is only accessible after submitting your work. If you believe this is an error, please contact your teacher.
        </p>
        <button
          type="button"
          onPointerDown={spawnRipple}
          onClick={() => router.push("/assessments")}
          className="cr-ripple cr-press ds-ring mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-extrabold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <ArrowLeft className="h-4 w-4" /> Back to assignments
        </button>
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
  const pct = result ? Math.round(Number(result.percent)) : 0;

  const handleFilterChange = (mode: FilterMode) => { setFilter(mode); setCurrentIndex(0); };
  const navigate = (delta: number) => {
    setCurrentIndex((prev) => {
      const next = prev + delta;
      if (next < 0 || next >= filteredQuestions.length) return prev;
      return next;
    });
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const displayTitle = meta.set_title?.trim() || meta.assignment_title?.trim() || "Assessment";
  const assignmentId = meta.assignment_id;

  const filterDefs: { key: FilterMode; label: string; count: number }[] = [
    { key: "all", label: "All", count: questions.length },
    { key: "incorrect", label: "To improve", count: incorrectCount },
    { key: "correct", label: "Correct", count: correctCount },
    { key: "unanswered", label: "Skipped", count: unansweredCount },
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-[18px] pb-12" style={{ fontFamily: JAKARTA }}>
      {/* back */}
      <button
        type="button"
        onClick={() => (assignmentId ? router.push(`/assessments/result/${assignmentId}`) : router.push("/assessments"))}
        className="ds-ring group inline-flex w-fit items-center gap-2 rounded-lg text-sm font-bold text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-[17px] w-[17px]" /> Back to results
      </button>

      {/* HERO — gradient score banner + stat grid */}
      {result ? (
        <div className="cr-celebpop relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary-hover p-8 text-primary-foreground shadow-xl sm:p-10">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-52 w-52 rounded-full bg-white/[0.06]" />
          <div aria-hidden className="pointer-events-none absolute right-8 top-8 opacity-10"><GraduationCap className="h-28 w-28" /></div>
          <div className="relative z-10 flex flex-col items-center text-center">
            {meta.classroom_name ? (
              <span className="mb-2 block text-[11px] font-extrabold uppercase tracking-[0.16em] text-primary-foreground/70">{meta.classroom_name}</span>
            ) : null}
            <span className="block text-base font-extrabold uppercase tracking-[0.1em] text-primary-foreground/90">{displayTitle}</span>
            <p className="mb-1 mt-3 text-6xl font-black leading-none tracking-tight tabular-nums">{pct}%</p>
            <p className="text-[13px] font-semibold text-primary-foreground/80">
              {result.correct_count} of {result.total_questions} correct · {result.score_points} of {result.max_points} pts
            </p>

            <div className="mt-8 grid w-full max-w-2xl grid-cols-3 gap-5">
              <HeroStat value={correctCount} label="Correct" tone="text-emerald-300" />
              <HeroStat value={incorrectCount} label="To improve" tone="text-rose-300" />
              <HeroStat value={unansweredCount} label="Skipped" tone="text-sky-200" />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-3xl border border-border bg-card p-6 shadow-sm">
          <Spinner className="h-5 w-5 text-primary" />
          <p className="text-sm font-medium text-muted-foreground">Grading in progress — check back shortly.</p>
        </div>
      )}

      {/* retry actions */}
      {result && (incorrectCount > 0 || assignmentId) ? (
        <div className="flex flex-col gap-2.5 sm:flex-row">
          {incorrectCount > 0 ? (
            <RetryButton
              primary
              loading={retryMutation.isPending}
              onClick={() => retryMutation.mutate({ focusIds: questions.filter((q) => getQuestionOutcome(q) === "incorrect").map((q) => q.id) })}
            >
              Try the {incorrectCount} missed question{incorrectCount !== 1 ? "s" : ""} again
            </RetryButton>
          ) : null}
          {assignmentId ? (
            <RetryButton loading={retryMutation.isPending} onClick={() => retryMutation.mutate({})}>
              Try all questions again
            </RetryButton>
          ) : null}
        </div>
      ) : null}
      {retryError ? <p className="text-xs font-semibold text-rose-600">{retryError}</p> : null}

      {data.teacher_feedback ? <TeacherFeedbackCard feedback={data.teacher_feedback} /> : null}

      {/* filter pills */}
      <div className="flex flex-wrap items-center gap-2.5">
        {filterDefs.map((f) => {
          const on = filter === f.key;
          const disabled = f.key !== "all" && f.count === 0;
          return (
            <button
              key={f.key}
              type="button"
              disabled={disabled}
              onPointerDown={spawnRipple}
              onClick={() => handleFilterChange(f.key)}
              className={cn(
                "cr-pillin cr-press cr-ripple inline-flex items-center gap-2 rounded-full border-[1.5px] px-[15px] py-2 text-[13.5px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-40",
                on
                  ? "border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900"
                  : "border-border bg-card text-foreground hover:bg-surface-2",
              )}
            >
              {f.label}
              <span className={cn("ds-num rounded-full px-2 py-px text-[12px] font-extrabold", on ? "bg-white/20 text-current" : "bg-surface-2 text-label-foreground")}>
                {f.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* question dot navigator */}
      {filteredQuestions.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {filteredQuestions.map((q, i) => {
            const outcome = getQuestionOutcome(q);
            const active = i === safeIndex;
            return (
              <button
                key={q.id}
                type="button"
                aria-label={`Go to question ${i + 1}`}
                onClick={() => { setCurrentIndex(i); cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                className={cn(
                  "ds-ring flex h-9 w-9 items-center justify-center rounded-xl text-[13px] font-extrabold transition-all",
                  active
                    ? cn("text-white shadow-sm scale-105", OUTCOME_META[outcome].dot)
                    : "border border-border bg-card text-muted-foreground hover:bg-surface-2",
                )}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* question deep-dive */}
      <div ref={cardRef}>
        {filteredQuestions.length === 0 ? (
          <div className="rounded-3xl border border-border bg-card px-6 py-12 text-center shadow-sm">
            <p className="text-sm font-semibold text-muted-foreground">No questions in this view.</p>
            <button type="button" onClick={() => handleFilterChange("all")} className="ds-ring mt-3 rounded text-sm font-extrabold text-primary hover:text-primary-hover hover:underline">
              Show all questions
            </button>
          </div>
        ) : current ? (
          <QuestionDeepDive q={current} index={safeIndex} total={filteredQuestions.length} />
        ) : null}
      </div>

      {/* prev / next */}
      {filteredQuestions.length > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <NavButton onClick={() => navigate(-1)} disabled={safeIndex === 0}>
            <ArrowLeft className="h-4 w-4" /> Previous
          </NavButton>
          <span className="ds-num text-sm font-bold text-muted-foreground">{safeIndex + 1} / {filteredQuestions.length}</span>
          <NavButton primary onClick={() => navigate(1)} disabled={safeIndex >= filteredQuestions.length - 1}>
            Next <ChevronRight className="h-4 w-4" />
          </NavButton>
        </div>
      ) : null}

      {/* bottom CTA */}
      <div className="flex flex-col items-center justify-between gap-3 rounded-3xl border border-border bg-surface-2/50 p-6 sm:flex-row">
        <p className="text-center text-sm font-medium text-muted-foreground sm:text-left">Ready to move on? Head back to your assignments.</p>
        <button
          type="button"
          onPointerDown={spawnRipple}
          onClick={() => router.push("/assessments")}
          className="cr-ripple cr-press ds-ring inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-extrabold text-foreground transition-colors hover:bg-surface-2"
        >
          <BookOpen className="h-4 w-4" /> My assignments
        </button>
      </div>
    </div>
  );
}

function HeroStat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="flex flex-col items-center">
      <p className={cn("text-3xl font-black tabular-nums", tone)}>{value}</p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground/60">{label}</p>
    </div>
  );
}

function RetryButton({ children, onClick, loading, primary }: { children: React.ReactNode; onClick: () => void; loading?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onPointerDown={spawnRipple}
      onClick={onClick}
      disabled={loading}
      className={cn(
        "cr-ripple cr-press ds-ring inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-extrabold transition-colors disabled:opacity-60",
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary-hover"
          : "border border-border bg-card text-foreground hover:bg-surface-2",
      )}
    >
      <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> {children}
    </button>
  );
}

function NavButton({ children, onClick, disabled, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onPointerDown={spawnRipple}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "cr-ripple cr-press ds-ring inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-extrabold transition-all disabled:pointer-events-none disabled:opacity-40",
        primary
          ? "bg-primary text-primary-foreground shadow-md hover:bg-primary-hover"
          : "border-2 border-foreground bg-card text-foreground hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

export default function PedagogicalReviewPage() {
  return (
    <AuthGuard>
      <PedagogicalReviewContent />
    </AuthGuard>
  );
}
