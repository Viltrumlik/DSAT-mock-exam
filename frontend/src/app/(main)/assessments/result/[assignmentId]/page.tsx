"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import AuthGuard from "@/components/AuthGuard";
import { useMyAssessmentResult } from "@/features/assessments/hooks";
import { assessmentsStudentApi } from "@/features/assessmentsStudent/api";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  Lightbulb,
  Loader2,
  RefreshCw,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

type HwMeta = {
  assignment_title: string | null;
  set_title: string | null;
  set_category: string | null;
  due_at: string | null;
  question_count: number;
  classroom_name: string | null;
};

type MyResultData = {
  attempt: {
    id: number;
    status: string;
    grading_status?: string | null;
    total_time_seconds?: number | null;
    answers?: Array<{
      question_id: number;
      answer: string | null;
      is_correct: boolean | null;
      points_awarded?: number | null;
    }>;
  } | null;
  result: {
    score_points: string;
    max_points: string;
    percent: string;
    correct_count: number;
    total_questions: number;
    graded_at?: string | null;
  } | null;
  meta?: HwMeta;
};

// ─── Score ring ───────────────────────────────────────────────────────────────

function ScoreRing({ percent, size = 120 }: { percent: number; size?: number }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, percent)) / 100;
  const offset = circumference * (1 - filled);

  const color =
    percent >= 80
      ? "#10b981" // emerald
      : percent >= 60
      ? "#f59e0b" // amber
      : "#ef4444"; // red

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        className="text-border"
        strokeWidth={8}
      />
      {/* Fill */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      {/* Label (counter-rotated) */}
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        className="rotate-90 fill-foreground text-lg font-extrabold"
        style={{
          transform: `rotate(90deg)`,
          transformOrigin: `${size / 2}px ${size / 2}px`,
          fontSize: size >= 100 ? "1.25rem" : "1rem",
          fontWeight: 800,
          fill: color,
        }}
      >
        {Math.round(percent)}%
      </text>
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatGradedAt(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function getPerformanceTier(percent: number): { label: string; color: string; bg: string } {
  if (percent >= 90) return { label: "Excellent", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" };
  if (percent >= 75) return { label: "Good", color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" };
  if (percent >= 60) return { label: "Needs review", color: "text-amber-700", bg: "bg-amber-50 border-amber-200" };
  return { label: "Needs improvement", color: "text-red-700", bg: "bg-red-50 border-red-200" };
}

// ─── Learning interpretation ──────────────────────────────────────────────────

type LearningInsight = {
  headline: string;
  body: string;
  cta?: string;
  tone: "success" | "neutral" | "encourage";
};

type AnswerRow = { question_id: number; answer: string | null; is_correct: boolean | null; points_awarded?: number | null };

/**
 * Returns 1-indexed question numbers for all incorrect answers.
 * Only returns a non-empty array when the list is short enough to be useful
 * (≤10 wrong) — for longer lists a raw number count is clearer.
 */
function incorrectQuestionNumbers(answers: AnswerRow[] | undefined): number[] {
  if (!answers?.length) return [];
  const nums: number[] = [];
  answers.forEach((a, i) => {
    if (a.is_correct === false) nums.push(i + 1);
  });
  return nums.length <= 10 ? nums : [];
}

/** Formats a list of question numbers for natural prose. */
function formatQuestionList(nums: number[]): string {
  if (!nums.length) return "";
  if (nums.length === 1) return `question ${nums[0]}`;
  const last = nums[nums.length - 1];
  return `questions ${nums.slice(0, -1).join(", ")} and ${last}`;
}

/** Finds the longest consecutive run of incorrect answers in the breakdown. */
function longestIncorrectStreak(answers: AnswerRow[] | undefined): number {
  if (!answers?.length) return 0;
  let max = 0;
  let cur = 0;
  for (const a of answers) {
    if (a.is_correct === false) {
      cur++;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

function getLearningInsight(
  percent: number,
  correctCount: number,
  totalQuestions: number,
  timeSeconds: number | null | undefined,
  answers?: AnswerRow[],
): LearningInsight {
  const incorrect = totalQuestions - correctCount;
  const streak = longestIncorrectStreak(answers);
  const streakHint =
    streak >= 3
      ? ` You hit a run of ${streak} consecutive questions you found difficult — that cluster is worth revisiting specifically.`
      : "";

  // Specific question numbers when the wrong-answer list is short enough to be actionable
  const wrongNums = incorrectQuestionNumbers(answers);
  const specificHint =
    wrongNums.length > 0
      ? ` You missed ${formatQuestionList(wrongNums)}.`
      : "";

  if (percent >= 90) {
    return {
      headline: "Outstanding work.",
      body: `You answered ${correctCount} out of ${totalQuestions} correctly.${specificHint} At this level, focus on consistency — try another set to confirm this score holds under fresh material.`,
      cta: "Keep up the momentum",
      tone: "success",
    };
  }
  if (percent >= 75) {
    return {
      headline: "Solid performance.",
      body: `You got ${correctCount} right and missed ${incorrect}.${specificHint}${streakHint} At this score, targeted practice on a small number of weak spots is the fastest path to a top result.`,
      cta: "Focus on missed questions",
      tone: "neutral",
    };
  }
  if (percent >= 60) {
    return {
      headline: "You're making real progress.",
      body: `${correctCount} correct, ${incorrect} to work on.${specificHint}${streakHint} Students at this level typically close the gap by identifying two or three recurring mistake patterns rather than re-doing the whole set.`,
      cta: "Find your mistake patterns",
      tone: "encourage",
    };
  }
  if (percent >= 40) {
    return {
      headline: "Solid foundation to build from.",
      body: `${correctCount} out of ${totalQuestions} right — you're already past the harder half.${specificHint}${streakHint} The most effective move now is to understand the reasoning behind each question you missed, not just mark the correct answer.`,
      cta: "Review each missed question",
      tone: "encourage",
    };
  }
  // Low score — most important to feel supported, not judged
  return {
    headline: "This is where learning starts.",
    body: `Every attempt on a hard paper teaches you something the next one builds on.${specificHint} ${incorrect} questions to revisit — go through them slowly, one at a time, and ask why each answer is right. That process is the study.${streakHint}`,
    cta: "Go through missed questions",
    tone: "encourage",
  };
}

// ─── Next-step recommendation ─────────────────────────────────────────────────
// Returns a structured, score-band-specific recommended action. Designed to
// feel like advice from a thoughtful tutor, not a generic dashboard widget.

type NextStep = {
  /** Short imperative headline. */
  action: string;
  /** One or two sentences explaining the why. Concrete, not motivational filler. */
  rationale: string;
  /** Primary CTA label. */
  primaryLabel: string;
  /** If true, show "Re-attempt this set" as primary; "Browse assessments" secondary. */
  preferRetry: boolean;
};

function getNextStep(
  percent: number,
  incorrectCount: number,
  wrongNums: number[],
): NextStep {
  if (percent >= 90) {
    return {
      action: "Push the ceiling with a harder set",
      rationale:
        "You've mastered this difficulty level. Repeating it won't move your score — a harder paper will expose the gaps that are left.",
      primaryLabel: "Browse assessments",
      preferRetry: false,
    };
  }
  if (percent >= 75) {
    const qRef =
      wrongNums.length > 0
        ? `the ${wrongNums.length} question${wrongNums.length === 1 ? "" : "s"} you missed`
        : `your ${incorrectCount} missed question${incorrectCount === 1 ? "" : "s"}`;
    return {
      action: `Understand ${qRef}, then re-attempt`,
      rationale:
        "At this score, one focused re-attempt after reviewing your mistakes typically adds 5–10%. Don't skip straight to a new set — reuse this one.",
      primaryLabel: "Re-attempt this set",
      preferRetry: true,
    };
  }
  if (percent >= 50) {
    return {
      action: "Review each wrong answer, then do a fresh attempt",
      rationale:
        "Before you start anything new, scroll up and understand why each incorrect answer was wrong. That process — not more volume — is what moves scores at this level.",
      primaryLabel: "Re-attempt this set",
      preferRetry: true,
    };
  }
  // < 50% — reframe around manageable starting points, not total volume
  return {
    action: "Start with just your 3 hardest questions",
    rationale:
      "Don't review everything at once. Pick the 3 questions above that felt most unfamiliar and understand them fully. That's enough for one session — come back to the rest tomorrow.",
    primaryLabel: "Re-attempt this set",
    preferRetry: true,
  };
}

function getPacingInsight(timeSeconds: number | null | undefined, totalQuestions: number): string | null {
  if (!timeSeconds || totalQuestions === 0) return null;
  const secPerQ = timeSeconds / totalQuestions;
  if (secPerQ < 45) return `You averaged about ${Math.round(secPerQ)}s per question — very quick. Make sure speed isn't costing you accuracy.`;
  if (secPerQ < 90) return `Your pace was steady at around ${Math.round(secPerQ)}s per question — a comfortable rhythm.`;
  if (secPerQ < 150) return `You spent about ${Math.round(secPerQ / 60 * 10) / 10} minutes per question. That's thoughtful — watch the clock on timed exams.`;
  return `You took a careful ${Math.round(secPerQ / 60 * 10) / 10} minutes per question on average. Practice moving a little faster on questions you're confident about.`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssessmentResultPage() {
  const router = useRouter();
  const { assignmentId } = useParams();
  const aid = Number(assignmentId);
  const { data, isLoading, error, refetch } = useMyAssessmentResult(aid);

  const [retryLoading, setRetryLoading] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const richData = data as MyResultData | undefined;
  const attempt = richData?.attempt ?? null;
  const result = richData?.result ?? null;
  const meta = richData?.meta ?? null;

  const displayTitle =
    meta?.assignment_title?.trim() ||
    meta?.set_title?.trim() ||
    "Assessment";

  const percent = result ? Number(result.percent) : 0;
  const tier = result ? getPerformanceTier(percent) : null;
  const timeStr = formatTime(attempt?.total_time_seconds);
  const gradedAtStr = formatGradedAt(result?.graded_at);

  // Per-question breakdown (if answers are in the attempt data)
  const answers = attempt?.answers ?? [];
  const hasBreakdown = answers.length > 0;

  // Retry incorrect questions only
  const handleRetryIncorrect = async () => {
    const incorrectIds = answers
      .filter((a) => a.is_correct === false)
      .map((a) => a.question_id);
    if (!incorrectIds.length || !aid) return;
    setRetryLoading(true);
    setRetryError(null);
    try {
      const newAttempt = await assessmentsStudentApi.start({
        assignment_id: aid,
        focus_question_ids: incorrectIds,
      });
      router.push(`/assessments/attempt/${newAttempt.id}`);
    } catch {
      setRetryError("Could not start retry. Please try again.");
      setRetryLoading(false);
    }
  };

  // Learning interpretation
  const insight = result
    ? getLearningInsight(percent, result.correct_count, result.total_questions, attempt?.total_time_seconds, attempt?.answers ?? undefined)
    : null;
  const pacingInsight = result
    ? getPacingInsight(attempt?.total_time_seconds, result.total_questions)
    : null;

  // Structured next-step recommendation (score-band-specific, actionable)
  const wrongNums = result ? incorrectQuestionNumbers(attempt?.answers ?? undefined) : [];
  const incorrectCount = result ? result.total_questions - result.correct_count : 0;
  const nextStep = result ? getNextStep(percent, incorrectCount, wrongNums) : null;

  return (
    <AuthGuard>
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {/* Back */}
        <button
          type="button"
          onClick={() => router.push(`/assessments/${aid}`)}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to assignment
        </button>

        {/* Loading */}
        {isLoading && (
          <div className="rounded-2xl border border-border bg-card p-10 flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="text-sm font-bold text-red-800">Could not load result</p>
            <p className="text-sm text-red-700 mt-1">
              {String((error as { message?: string })?.message || "Unknown error")}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        )}

        {/* Not yet graded */}
        {!isLoading && !error && !result && attempt && (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
            <p className="font-extrabold text-foreground">Grading in progress</p>
            <p className="text-sm text-muted-foreground mt-1">
              Results will appear here once grading is complete.
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-surface-2"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Check again
            </button>
          </div>
        )}

        {/* No attempt */}
        {!isLoading && !error && !attempt && (
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <p className="font-extrabold text-foreground">No attempt yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              You haven't started this assignment yet.
            </p>
            <button
              type="button"
              onClick={() => router.push(`/assessments/${aid}`)}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
            >
              <ChevronRight className="h-4 w-4" />
              Go to assignment
            </button>
          </div>
        )}

        {/* ── Main result card ─────────────────────────────────────────────── */}
        {!isLoading && !error && result && (
          <>
            {/* Header + score */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
              <div className="border-b border-border px-6 py-5">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <p className="text-[10px] font-bold text-primary uppercase tracking-widest">
                    Results
                  </p>
                  {meta?.classroom_name && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      <BookOpen className="h-3 w-3" />
                      {meta.classroom_name}
                    </span>
                  )}
                </div>
                <h1 className="text-xl font-extrabold text-foreground tracking-tight">
                  {displayTitle}
                </h1>
                {meta?.set_category && (
                  <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" />
                    {meta.set_category}
                  </p>
                )}
              </div>

              {/* Score hero */}
              <div className="px-6 py-6 flex items-center gap-6">
                <ScoreRing percent={percent} size={108} />
                <div className="flex-1 min-w-0">
                  <div className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold mb-2", tier?.bg, tier?.color)}>
                    {tier?.label}
                  </div>
                  <p className="text-3xl font-extrabold tabular-nums text-foreground leading-none">
                    {result.correct_count}
                    <span className="text-lg font-bold text-muted-foreground">
                      {" "}/ {result.total_questions}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    correct answers
                  </p>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-3 border-t border-border divide-x divide-border">
                <div className="px-4 py-3 text-center">
                  <p className="text-lg font-extrabold tabular-nums text-foreground">
                    {result.score_points}
                  </p>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
                    Points
                  </p>
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-lg font-extrabold tabular-nums text-foreground">
                    {result.max_points}
                  </p>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
                    Max
                  </p>
                </div>
                <div className="px-4 py-3 text-center">
                  <p className="text-lg font-extrabold tabular-nums text-foreground">
                    {timeStr}
                  </p>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
                    Time
                  </p>
                </div>
              </div>

              {gradedAtStr && (
                <div className="border-t border-border px-5 py-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Graded {gradedAtStr}
                </div>
              )}
            </div>

            {/* ── Learning interpretation ─────────────────────────────────── */}
            {insight && (
              <div className={cn(
                "rounded-2xl border p-5 space-y-3",
                insight.tone === "success" ? "border-emerald-200 bg-emerald-50" :
                insight.tone === "encourage" ? "border-amber-200 bg-amber-50" :
                "border-border bg-card"
              )}>
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "rounded-xl p-2 shrink-0",
                    insight.tone === "success" ? "bg-emerald-100" :
                    insight.tone === "encourage" ? "bg-amber-100" :
                    "bg-surface-2"
                  )}>
                    {insight.tone === "success" ? (
                      <TrendingUp className="h-4 w-4 text-emerald-700" />
                    ) : insight.tone === "encourage" ? (
                      <Lightbulb className="h-4 w-4 text-amber-700" />
                    ) : (
                      <Target className="h-4 w-4 text-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "text-sm font-extrabold",
                      insight.tone === "success" ? "text-emerald-900" :
                      insight.tone === "encourage" ? "text-amber-900" :
                      "text-foreground"
                    )}>
                      {insight.headline}
                    </p>
                    <p className={cn(
                      "text-sm mt-1 leading-relaxed",
                      insight.tone === "success" ? "text-emerald-800" :
                      insight.tone === "encourage" ? "text-amber-800" :
                      "text-muted-foreground"
                    )}>
                      {insight.body}
                    </p>
                  </div>
                </div>

                {/* Pacing insight */}
                {pacingInsight && (
                  <div className="border-t border-black/5 pt-3 flex items-start gap-2">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground leading-relaxed">{pacingInsight}</p>
                  </div>
                )}
              </div>
            )}

            {/* Per-question breakdown (if available) */}
            {hasBreakdown && attempt && (
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="border-b border-border px-5 py-3 flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-bold text-foreground">Question breakdown</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    {answers.some((a) => a.is_correct === false) && (
                      <button
                        type="button"
                        disabled={retryLoading}
                        onClick={handleRetryIncorrect}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
                      >
                        {retryLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Retry incorrect
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => router.push(`/assessments/review/${attempt.id}`)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Review all
                    </button>
                  </div>
                </div>
                {retryError && <p className="px-5 py-2 text-xs text-red-600">{retryError}</p>}
                <div className="divide-y divide-border">
                  {answers.map((ans, i) => (
                    <button
                      key={ans.question_id}
                      type="button"
                      onClick={() => router.push(`/assessments/review/${attempt.id}?q=${i + 1}`)}
                      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-surface-2 transition-colors text-left"
                    >
                      <span className="text-xs font-bold text-muted-foreground w-6 text-right shrink-0">
                        {i + 1}
                      </span>
                      {ans.is_correct === true ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      ) : ans.is_correct === false ? (
                        <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                      ) : (
                        <div className="h-4 w-4 rounded-full border-2 border-muted shrink-0" />
                      )}
                      <span
                        className={cn(
                          "text-sm font-semibold flex-1",
                          ans.is_correct === true
                            ? "text-emerald-700"
                            : ans.is_correct === false
                            ? "text-red-700"
                            : "text-muted-foreground",
                        )}
                      >
                        {ans.is_correct === true
                          ? "Correct"
                          : ans.is_correct === false
                          ? "Incorrect"
                          : "Not answered"}
                      </span>
                      {ans.points_awarded != null && (
                        <span className="text-xs font-bold text-muted-foreground">
                          +{ans.points_awarded} pts
                        </span>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── What to do next (score-band-specific, structured) ────────── */}
            {nextStep && result && (
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="border-b border-border px-5 py-3 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary shrink-0" />
                    <p className="text-sm font-extrabold text-foreground">What to do next</p>
                  </div>
                  {/* Score improvement target */}
                  {percent < 90 && (
                    <span className="text-xs font-bold text-primary bg-primary/8 px-2.5 py-1 rounded-full">
                      Next aim: {Math.min(100, Math.ceil(percent / 10) * 10 + (percent % 10 === 0 ? 10 : 0))}%+
                    </span>
                  )}
                  {percent >= 90 && (
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                      Target: maintain 90%+
                    </span>
                  )}
                </div>
                <div className="px-5 py-4 space-y-3">
                  <p className="text-sm font-extrabold text-foreground">{nextStep.action}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{nextStep.rationale}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {nextStep.preferRetry ? (
                      <>
                        <button
                          type="button"
                          onClick={() => router.push(`/assessments/${aid}`)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <RefreshCw className="h-4 w-4" />
                          {nextStep.primaryLabel}
                        </button>
                        <a
                          href="/assessments"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
                        >
                          <BookOpen className="h-4 w-4" />
                          Browse assessments
                        </a>
                      </>
                    ) : (
                      <>
                        <a
                          href="/assessments"
                          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          <BookOpen className="h-4 w-4" />
                          {nextStep.primaryLabel}
                        </a>
                        <button
                          type="button"
                          onClick={() => router.push(`/assessments/${aid}`)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
                        >
                          <RefreshCw className="h-4 w-4" />
                          Re-attempt this set
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end pb-6">
              <button
                type="button"
                onClick={() => router.push(`/assessments/${aid}`)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to assignment
              </button>
            </div>
          </>
        )}
      </div>
    </AuthGuard>
  );
}
