"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AuthGuard from "@/components/AuthGuard";
import { useMyAssessmentResult, useStartAttempt } from "@/features/assessments/hooks";
import { assessmentsStudentApi, type PedagogicalReviewQuestion } from "@/features/assessmentsStudent/api";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, Button, EmptyState, Spinner } from "@/components/ui";
import { SummaryResultView, type SummaryRow, type SummaryRowStatus } from "@/features/assessments/components/SummaryResultView";
import { QuestionReviewModal } from "@/features/assessments/components/QuestionReviewModal";

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

// ─── Helpers ────────────────────────────────────────────────────────────────

/** s>=60 → "Xm Ys" else "Xs". */
function fmtSec(s: number): string {
  if (!s || s <= 0) return "0s";
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function statusOf(q: PedagogicalReviewQuestion): SummaryRowStatus {
  if (q.is_correct === true) return "correct";
  const sa = q.student_answer;
  const empty = sa === null || sa === undefined || (typeof sa === "string" && sa.trim() === "");
  if (empty) return "omitted";
  return "incorrect";
}

function answerToDisplay(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.trim() === "" ? "—" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => answerToDisplay(v)).join(", ");
  return String(value);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssessmentResultPage() {
  const router = useRouter();
  const { assignmentId } = useParams();
  const aid = Number(assignmentId);
  const { data, isLoading, error, refetch } = useMyAssessmentResult(aid);

  const richData = data as MyResultData | undefined;
  const attempt = richData?.attempt ?? null;
  const result = richData?.result ?? null;
  const meta = richData?.meta ?? null;

  const graded = !!result;
  const attemptId = attempt?.id ?? 0;

  // Pedagogical review — the per-question breakdown (with correct answers + student answers).
  const reviewQuery = useQuery({
    queryKey: ["assessmentPedagogicalReview", attemptId],
    queryFn: () => assessmentsStudentApi.pedagogicalReview(attemptId),
    enabled: graded && Number.isFinite(attemptId) && attemptId > 0,
  });
  const review = reviewQuery.data ?? null;

  // ── Derived top-level values ──
  const displayTitle = meta?.set_title?.trim() || meta?.assignment_title?.trim() || "Assessment";
  const percent = result ? Math.round(Number(result.percent)) : 0;
  const totalQuestions = result?.total_questions ?? 0;
  const correctCount = result?.correct_count ?? 0;
  const totalTime = attempt?.total_time_seconds ?? 0;
  const avgPerQuestion = totalQuestions > 0 ? Math.round(totalTime / totalQuestions) : 0;

  const questionTimes = attempt?.question_times ?? null;
  const timeForQuestion = (qid: number): number => (questionTimes ? Number(questionTimes[String(qid)] || 0) : 0);

  // Questions sorted by order — the modal pages through these; rows mirror the order.
  const sortedQuestions = useMemo(
    () => [...(review?.questions ?? [])].sort((a, b) => a.order - b.order),
    [review],
  );

  // Which question is open in the pop-up review modal (null = closed).
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);

  // Retry the assessment from within the review page (starts a fresh attempt).
  const start = useStartAttempt();
  const [retrying, setRetrying] = useState(false);
  const retryAssessment = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const att = await start.mutateAsync({ assignment_id: aid });
      router.push(`/assessments/attempt/${att.id}`);
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
      setRetrying(false);
    }
  };

  // Build presentational rows (sorted by question order).
  const rows: SummaryRow[] = useMemo(() => {
    return sortedQuestions.map((q) => ({
      id: q.id,
      order: q.order,
      status: statusOf(q),
      correctDisplay: answerToDisplay(q.correct_answer),
      seconds: timeForQuestion(q.id),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedQuestions, questionTimes]);

  return (
    <AuthGuard>
      <div className="mx-auto w-full max-w-4xl pb-12">
        {isLoading ? (
          <Card><CardContent className="flex justify-center py-12"><Spinner className="h-8 w-8 text-primary" /></CardContent></Card>
        ) : null}

        {error && !isLoading ? (
          <EmptyState
            title="Could not load result"
            description={String((error as { message?: string })?.message || "Unknown error")}
            action={<Button variant="secondary" leftIcon={<RefreshCw />} onClick={() => void refetch()}>Retry</Button>}
          />
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
          <EmptyState
            title="No attempt yet"
            description="You haven't started this assignment yet."
            action={<Button onClick={() => router.push(`/assessments/${aid}`)}>Go to assignment</Button>}
          />
        ) : null}

        {!isLoading && !error && result ? (
          <SummaryResultView
            title={displayTitle}
            percent={percent}
            correctCount={correctCount}
            totalQuestions={totalQuestions}
            totalTimeLabel={fmtSec(totalTime)}
            scorePoints={result.score_points}
            maxPoints={result.max_points}
            avgPerQuestionLabel={`${avgPerQuestion} sec`}
            rows={rows}
            onBack={() => router.push(`/assessments`)}
            onRetry={retryAssessment}
            retrying={retrying}
            onReview={(row) => {
              const idx = sortedQuestions.findIndex((q) => q.id === row.id);
              if (idx >= 0) setReviewIndex(idx);
            }}
          />
        ) : null}

        {/* Per-question review pops up in a modal (mirrors the pastpaper review). */}
        {reviewIndex != null && sortedQuestions.length > 0 ? (
          <QuestionReviewModal
            questions={sortedQuestions}
            index={reviewIndex}
            onIndexChange={setReviewIndex}
            onClose={() => setReviewIndex(null)}
          />
        ) : null}
      </div>
    </AuthGuard>
  );
}
