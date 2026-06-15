"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { useMyAssessmentResult } from "@/features/assessments/hooks";
import { assessmentsStudentApi } from "@/features/assessmentsStudent/api";
import {
  ArrowLeft, BookOpen, CheckCircle2, ChevronRight, Clock, Eye, Lightbulb, Loader2, RefreshCw, Target, TrendingUp, XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardContent, Badge, Button, ProgressRing, Alert, EmptyState, Spinner, type BadgeVariant } from "@/components/ui";

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
    question_times?: Record<string, number> | null;
    answers?: Array<{ question_id: number; answer: string | null; is_correct: boolean | null; points_awarded?: number | null }>;
  } | null;
  result: { score_points: string; max_points: string; percent: string; correct_count: number; total_questions: number; graded_at?: string | null } | null;
  meta?: HwMeta;
};

// ─── Helpers (business logic preserved verbatim) ─────────────────────────────

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
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function getPerformanceTier(percent: number): { label: string } {
  if (percent >= 90) return { label: "Excellent" };
  if (percent >= 75) return { label: "Good" };
  if (percent >= 60) return { label: "Needs review" };
  return { label: "Keep building" };
}

// Score-band tone — positive/neutral (no punishing red for the overall band).
function tierVariant(percent: number): BadgeVariant {
  if (percent >= 75) return "success";
  if (percent >= 60) return "info";
  return "warning";
}
function ringColor(percent: number): string {
  if (percent >= 75) return "text-success";
  if (percent >= 50) return "text-primary";
  return "text-warning";
}

type LearningInsight = { headline: string; body: string; cta?: string; tone: "success" | "neutral" | "encourage" };
type AnswerRow = { question_id: number; answer: string | null; is_correct: boolean | null; points_awarded?: number | null };

function incorrectQuestionNumbers(answers: AnswerRow[] | undefined): number[] {
  if (!answers?.length) return [];
  const nums: number[] = [];
  answers.forEach((a, i) => { if (a.is_correct === false) nums.push(i + 1); });
  return nums.length <= 10 ? nums : [];
}
function formatQuestionList(nums: number[]): string {
  if (!nums.length) return "";
  if (nums.length === 1) return `question ${nums[0]}`;
  const last = nums[nums.length - 1];
  return `questions ${nums.slice(0, -1).join(", ")} and ${last}`;
}
function longestIncorrectStreak(answers: AnswerRow[] | undefined): number {
  if (!answers?.length) return 0;
  let max = 0, cur = 0;
  for (const a of answers) {
    if (a.is_correct === false) { cur++; if (cur > max) max = cur; } else { cur = 0; }
  }
  return max;
}

function getLearningInsight(
  percent: number, correctCount: number, totalQuestions: number,
  timeSeconds: number | null | undefined, answers?: AnswerRow[],
): LearningInsight {
  const incorrect = totalQuestions - correctCount;
  const streak = longestIncorrectStreak(answers);
  const streakHint = streak >= 3 ? ` You hit a run of ${streak} consecutive questions you found difficult — that cluster is worth revisiting specifically.` : "";
  const wrongNums = incorrectQuestionNumbers(answers);
  const specificHint = wrongNums.length > 0 ? ` You missed ${formatQuestionList(wrongNums)}.` : "";
  void timeSeconds;

  if (percent >= 90) {
    return { headline: "Outstanding work.", body: `You answered ${correctCount} out of ${totalQuestions} correctly.${specificHint} At this level, focus on consistency — try another set to confirm this score holds under fresh material.`, cta: "Keep up the momentum", tone: "success" };
  }
  if (percent >= 75) {
    return { headline: "Solid performance.", body: `You got ${correctCount} right and missed ${incorrect}.${specificHint}${streakHint} At this score, targeted practice on a small number of weak spots is the fastest path to a top result.`, cta: "Focus on missed questions", tone: "neutral" };
  }
  if (percent >= 60) {
    return { headline: "You're making real progress.", body: `${correctCount} correct, ${incorrect} to work on.${specificHint}${streakHint} Students at this level typically close the gap by identifying two or three recurring mistake patterns rather than re-doing the whole set.`, cta: "Find your mistake patterns", tone: "encourage" };
  }
  if (percent >= 40) {
    return { headline: "Solid foundation to build from.", body: `${correctCount} out of ${totalQuestions} right — you're already past the harder half.${specificHint}${streakHint} The most effective move now is to understand the reasoning behind each question you missed, not just mark the correct answer.`, cta: "Review each missed question", tone: "encourage" };
  }
  return { headline: "This is where learning starts.", body: `Every attempt on a hard paper teaches you something the next one builds on.${specificHint} ${incorrect} questions to revisit — go through them slowly, one at a time, and ask why each answer is right. That process is the study.${streakHint}`, cta: "Go through missed questions", tone: "encourage" };
}

type NextStep = { action: string; rationale: string; primaryLabel: string; preferRetry: boolean };

function getNextStep(percent: number, incorrectCount: number, wrongNums: number[]): NextStep {
  if (percent >= 90) {
    return { action: "Push the ceiling with a harder set", rationale: "You've mastered this difficulty level. Repeating it won't move your score — a harder paper will expose the gaps that are left.", primaryLabel: "Browse assessments", preferRetry: false };
  }
  if (percent >= 75) {
    const qRef = wrongNums.length > 0 ? `the ${wrongNums.length} question${wrongNums.length === 1 ? "" : "s"} you missed` : `your ${incorrectCount} missed question${incorrectCount === 1 ? "" : "s"}`;
    return { action: `Understand ${qRef}, then re-attempt`, rationale: "At this score, one focused re-attempt after reviewing your mistakes typically adds 5–10%. Don't skip straight to a new set — reuse this one.", primaryLabel: "Re-attempt this set", preferRetry: true };
  }
  if (percent >= 50) {
    return { action: "Review each wrong answer, then do a fresh attempt", rationale: "Before you start anything new, scroll up and understand why each incorrect answer was wrong. That process — not more volume — is what moves scores at this level.", primaryLabel: "Re-attempt this set", preferRetry: true };
  }
  return { action: "Start with just your 3 hardest questions", rationale: "Don't review everything at once. Pick the 3 questions above that felt most unfamiliar and understand them fully. That's enough for one session — come back to the rest tomorrow.", primaryLabel: "Re-attempt this set", preferRetry: true };
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

  const displayTitle = meta?.assignment_title?.trim() || meta?.set_title?.trim() || "Assessment";
  const percent = result ? Number(result.percent) : 0;
  const tier = result ? getPerformanceTier(percent) : null;
  const timeStr = formatTime(attempt?.total_time_seconds);
  const gradedAtStr = formatGradedAt(result?.graded_at);
  const answers = attempt?.answers ?? [];
  const hasBreakdown = answers.length > 0;

  const handleRetryIncorrect = async () => {
    const incorrectIds = answers.filter((a) => a.is_correct === false).map((a) => a.question_id);
    if (!incorrectIds.length || !aid) return;
    setRetryLoading(true);
    setRetryError(null);
    try {
      const newAttempt = await assessmentsStudentApi.start({ assignment_id: aid, focus_question_ids: incorrectIds });
      router.push(`/assessments/attempt/${newAttempt.id}`);
    } catch {
      setRetryError("Could not start retry. Please try again.");
      setRetryLoading(false);
    }
  };

  const insight = result ? getLearningInsight(percent, result.correct_count, result.total_questions, attempt?.total_time_seconds, attempt?.answers ?? undefined) : null;
  const pacingInsight = result ? getPacingInsight(attempt?.total_time_seconds, result.total_questions) : null;
  const wrongNums = result ? incorrectQuestionNumbers(attempt?.answers ?? undefined) : [];
  const incorrectCount = result ? result.total_questions - result.correct_count : 0;
  const nextStep = result ? getNextStep(percent, incorrectCount, wrongNums) : null;

  const insightTone = insight?.tone === "success" ? "success" : insight?.tone === "encourage" ? "warning" : "neutral";
  const InsightIcon = insight?.tone === "success" ? TrendingUp : insight?.tone === "encourage" ? Lightbulb : Target;

  return (
    <AuthGuard>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-12">
        <button type="button" onClick={() => router.push(`/assessments/${aid}`)} className="ds-ring inline-flex w-fit items-center gap-1.5 rounded-lg text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to assignment
        </button>

        {isLoading ? (
          <Card><CardContent className="flex justify-center py-12"><Spinner className="h-8 w-8 text-primary" /></CardContent></Card>
        ) : null}

        {error && !isLoading ? (
          <EmptyState title="Could not load result" description={String((error as { message?: string })?.message || "Unknown error")} action={<Button variant="secondary" leftIcon={<RefreshCw />} onClick={() => void refetch()}>Retry</Button>} />
        ) : null}

        {!isLoading && !error && !result && attempt ? (
          <Card><CardContent className="flex flex-col items-center py-10 text-center">
            <Spinner className="mb-3 h-8 w-8 text-primary" />
            <p className="ds-h4">Grading in progress</p>
            <p className="mt-1 text-sm text-muted-foreground">Results will appear here once grading is complete.</p>
            <Button className="mt-4" variant="secondary" leftIcon={<RefreshCw />} onClick={() => void refetch()}>Check again</Button>
          </CardContent></Card>
        ) : null}

        {!isLoading && !error && !attempt ? (
          <EmptyState title="No attempt yet" description="You haven't started this assignment yet." action={<Button rightIcon={<ChevronRight />} onClick={() => router.push(`/assessments/${aid}`)}>Go to assignment</Button>} />
        ) : null}

        {!isLoading && !error && result ? (
          <>
            {/* Header + score */}
            <Card>
              <div className="border-b border-border px-6 py-5">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="ds-overline text-primary">Results</span>
                  {meta?.classroom_name ? <Badge variant="neutral"><BookOpen className="h-3 w-3" /> {meta.classroom_name}</Badge> : null}
                </div>
                <h1 className="ds-h2">{displayTitle}</h1>
                {meta?.set_category ? <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground"><BookOpen className="h-3.5 w-3.5" /> {meta.set_category}</p> : null}
              </div>

              <div className="flex items-center gap-6 px-6 py-6">
                <ProgressRing value={percent} size={108} strokeWidth={8} color={ringColor(percent)} showLabel={false}>
                  <span className={cn("ds-num text-xl font-extrabold", ringColor(percent))}>{Math.round(percent)}%</span>
                </ProgressRing>
                <div className="min-w-0 flex-1">
                  {tier ? <span className="mb-2 inline-block"><Badge variant={tierVariant(percent)}>{tier.label}</Badge></span> : null}
                  <p className="ds-num text-3xl font-extrabold leading-none text-foreground">
                    {result.correct_count}<span className="text-lg font-bold text-muted-foreground"> / {result.total_questions}</span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">correct answers</p>
                </div>
              </div>

              <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
                {[{ v: result.score_points, l: "Points" }, { v: result.max_points, l: "Max" }, { v: timeStr, l: "Time" }].map((s) => (
                  <div key={s.l} className="px-4 py-3 text-center">
                    <p className="ds-num text-lg font-extrabold text-foreground">{s.v}</p>
                    <p className="ds-overline mt-0.5">{s.l}</p>
                  </div>
                ))}
              </div>

              {gradedAtStr ? <div className="flex items-center gap-1.5 border-t border-border px-5 py-2.5 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> Graded {gradedAtStr}</div> : null}
            </Card>

            {/* Learning interpretation */}
            {insight ? (
              <Card variant={insightTone === "neutral" ? "default" : "soft"} className={insightTone === "success" ? "border border-success/25 bg-success-soft" : insightTone === "warning" ? "border border-warning/25 bg-warning-soft" : undefined}>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-3">
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", insightTone === "success" ? "bg-success/15 text-success-foreground" : insightTone === "warning" ? "bg-warning/15 text-warning-foreground" : "bg-surface-2 text-foreground")}>
                      <InsightIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-extrabold text-foreground">{insight.headline}</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{insight.body}</p>
                    </div>
                  </div>
                  {pacingInsight ? (
                    <div className="flex items-start gap-2 border-t border-border pt-3">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <p className="text-xs leading-relaxed text-muted-foreground">{pacingInsight}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {/* Per-question breakdown */}
            {hasBreakdown && attempt ? (
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
                  <p className="ds-h4">Question breakdown</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {answers.some((a) => a.is_correct === false) ? (
                      <Button variant="secondary" size="sm" loading={retryLoading} leftIcon={<RefreshCw />} onClick={handleRetryIncorrect}>Retry incorrect</Button>
                    ) : null}
                    <Button variant="secondary" size="sm" leftIcon={<Eye />} onClick={() => router.push(`/assessments/review/${attempt.id}`)}>Review all</Button>
                  </div>
                </div>
                {retryError ? <p className="px-5 py-2 text-xs text-danger-foreground">{retryError}</p> : null}
                <div className="divide-y divide-border">
                  {answers.map((ans, i) => {
                    const qt = attempt?.question_times ?? null;
                    const sec = qt ? Number(qt[String(ans.question_id)] || 0) : 0;
                    return (
                      <button key={ans.question_id} type="button" onClick={() => router.push(`/assessments/review/${attempt.id}?q=${i + 1}`)} className="ds-ring flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2">
                        <span className="w-6 shrink-0 text-right text-xs font-bold text-muted-foreground">{i + 1}</span>
                        {ans.is_correct === true ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : ans.is_correct === false ? <XCircle className="h-4 w-4 shrink-0 text-danger" /> : <div className="h-4 w-4 shrink-0 rounded-full border-2 border-border" />}
                        <span className={cn("flex-1 text-sm font-semibold", ans.is_correct === true ? "text-success-foreground" : ans.is_correct === false ? "text-danger-foreground" : "text-muted-foreground")}>
                          {ans.is_correct === true ? "Correct" : ans.is_correct === false ? "Incorrect" : "Not answered"}
                        </span>
                        {sec > 0 ? <span className="ds-num inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Clock className="h-3 w-3" /> {formatTime(sec)}</span> : null}
                        {ans.points_awarded != null ? <span className="text-xs font-bold text-muted-foreground">+{ans.points_awarded} pts</span> : null}
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-label-foreground" />
                      </button>
                    );
                  })}
                </div>
              </Card>
            ) : null}

            {/* What to do next */}
            {nextStep && result ? (
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
                  <div className="flex items-center gap-2"><Target className="h-4 w-4 shrink-0 text-primary" /><p className="ds-h4">What to do next</p></div>
                  {percent < 90 ? (
                    <Badge variant="primary">Next aim: {Math.min(100, Math.ceil(percent / 10) * 10 + (percent % 10 === 0 ? 10 : 0))}%+</Badge>
                  ) : (
                    <Badge variant="success">Target: maintain 90%+</Badge>
                  )}
                </div>
                <CardContent className="space-y-3">
                  <p className="text-sm font-extrabold text-foreground">{nextStep.action}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{nextStep.rationale}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {nextStep.preferRetry ? (
                      <>
                        <Button leftIcon={<RefreshCw />} onClick={() => router.push(`/assessments/${aid}`)}>{nextStep.primaryLabel}</Button>
                        <Link href="/assessments"><Button variant="secondary" leftIcon={<BookOpen />}>Browse assessments</Button></Link>
                      </>
                    ) : (
                      <>
                        <Link href="/assessments"><Button leftIcon={<BookOpen />}>{nextStep.primaryLabel}</Button></Link>
                        <Button variant="secondary" leftIcon={<RefreshCw />} onClick={() => router.push(`/assessments/${aid}`)}>Re-attempt this set</Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <div className="flex justify-end">
              <Button variant="secondary" leftIcon={<ArrowLeft />} onClick={() => router.push(`/assessments/${aid}`)}>Back to assignment</Button>
            </div>
          </>
        ) : null}
      </div>
    </AuthGuard>
  );
}
