"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { normalizeApiError } from "@/lib/apiError";
import { useMyAssessmentResult, useStartAttempt } from "@/features/assessments/hooks";
import {
  ArrowLeft, BookOpen, CheckCircle2, ChevronRight, Clock, FileQuestion, Loader2, PlayCircle, School,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useState } from "react";
import { deriveAssignmentLifecycleState, formatAssignmentDue } from "@/lib/assignmentLifecycle";
import { Card, CardContent, Badge, Button, Alert, EmptyState, Spinner } from "@/components/ui";

type HwMeta = {
  assignment_title: string | null;
  set_title: string | null;
  set_category: string | null;
  due_at: string | null;
  question_count: number;
  classroom_name: string | null;
};

type MyResultData = {
  attempt: { id: number; status: string; grading_status?: string | null } | null;
  result: { score_points: string; max_points: string; percent: string; correct_count: number; total_questions: number } | null;
  meta?: HwMeta;
};

function formatDueDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function AssessmentStartPage() {
  const router = useRouter();
  const { assignmentId } = useParams();
  const aid = Number(assignmentId);

  const start = useStartAttempt();
  const { data, isLoading, error, refetch } = useMyAssessmentResult(aid);

  const richData = data as MyResultData | undefined;
  const attempt = richData?.attempt ?? null;
  const result = richData?.result ?? null;
  const meta = richData?.meta ?? null;

  const [startErr, setStartErr] = useState<string | null>(null);

  const canResume = attempt?.status === "in_progress";
  const isGraded = attempt?.status === "graded";
  const isSubmitted = attempt?.status === "submitted";
  const hasResult = result != null;
  const canViewResult = hasResult || isGraded || isSubmitted;

  const dueDateStr = formatDueDate(meta?.due_at);
  const lifecycleState = deriveAssignmentLifecycleState({
    due_at: meta?.due_at,
    submissions_count: (isGraded || isSubmitted || hasResult) ? 1 : 0,
  });
  const overdue = lifecycleState === "OVERDUE";
  const dueSoon = lifecycleState === "DUE_SOON";
  const relDueLabel = formatAssignmentDue(meta?.due_at);

  const begin = async () => {
    setStartErr(null);
    try {
      const att = await start.mutateAsync({ assignment_id: aid });
      router.push(`/assessments/attempt/${att.id}`);
    } catch (e) {
      setStartErr(normalizeApiError(e).message);
    }
  };

  const displayTitle = meta?.assignment_title?.trim() || meta?.set_title?.trim() || "Assessment";

  return (
    <AuthGuard>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-12">
        <Link href="/assessments" className="ds-ring inline-flex w-fit items-center gap-1.5 rounded-lg text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Assessments
        </Link>

        {isLoading ? (
          <Card><CardContent className="flex justify-center py-12"><Spinner className="h-8 w-8 text-primary" /></CardContent></Card>
        ) : error ? (
          <EmptyState
            title="Could not load assignment"
            description={String((error as { message?: string })?.message || "Unknown error")}
            action={<Button variant="secondary" leftIcon={<Loader2 />} onClick={() => void refetch()}>Retry</Button>}
          />
        ) : (
          <Card>
            <div className="border-b border-border px-6 py-5">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="ds-overline text-primary">Assessment</span>
                {meta?.classroom_name ? <Badge variant="neutral"><School className="h-3 w-3" /> {meta.classroom_name}</Badge> : null}
              </div>
              <h1 className="ds-h2">{displayTitle}</h1>
              {meta?.set_title && meta.set_title !== meta.assignment_title ? <p className="mt-0.5 text-sm text-muted-foreground">{meta.set_title}</p> : null}
            </div>

            <div className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border sm:grid-cols-3">
              {meta?.set_category ? (
                <MetaCell icon={BookOpen} label="Category" value={meta.set_category} />
              ) : null}
              {meta?.question_count != null ? (
                <MetaCell icon={FileQuestion} label="Questions" value={String(meta.question_count)} />
              ) : null}
              {dueDateStr ? (
                <div className="flex items-center gap-2 px-5 py-3">
                  <Clock className={cn("h-3.5 w-3.5 shrink-0", overdue || dueSoon ? "text-warning" : "text-muted-foreground")} />
                  <div>
                    <p className="ds-overline">Due</p>
                    <p className={cn("text-sm font-semibold", overdue || dueSoon ? "text-warning-foreground" : "text-foreground")}>{dueDateStr}</p>
                    {relDueLabel ? <p className={cn("text-[11px] font-bold", overdue || dueSoon ? "text-warning-foreground" : "text-muted-foreground")}>{relDueLabel}</p> : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-4 px-6 py-5">
              {hasResult ? (
                <div className="flex items-center gap-3 rounded-xl border border-success/25 bg-success-soft px-4 py-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                  <div>
                    <p className="text-sm font-bold text-success-foreground">Completed</p>
                    <p className="text-sm text-success-foreground">{result.correct_count} / {result.total_questions} correct · {Number(result.percent).toFixed(0)}%</p>
                  </div>
                  <button type="button" onClick={() => router.push(`/assessments/result/${aid}`)} className="ds-ring ml-auto inline-flex items-center gap-1 whitespace-nowrap rounded-lg text-sm font-bold text-success-foreground hover:underline">
                    See results <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}

              {canResume && !hasResult ? (
                <Alert tone="warning" title="In progress">You have an unfinished attempt. Resume to continue where you left off.</Alert>
              ) : null}

              {isSubmitted && !hasResult ? (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3">
                  <Spinner className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold text-foreground">Submitted — grading in progress…</p>
                </div>
              ) : null}

              {startErr ? <Alert tone="danger">{startErr}</Alert> : null}

              <div className="flex flex-wrap gap-2 pt-1">
                {!isGraded && !isSubmitted ? (
                  <Button
                    loading={start.isPending}
                    disabled={!Number.isFinite(aid) || aid <= 0}
                    leftIcon={<PlayCircle />}
                    onClick={() => void begin()}
                  >
                    {start.isPending ? "Starting…" : canResume ? "Resume" : "Start assessment"}
                  </Button>
                ) : null}
                {canViewResult ? (
                  <Button variant="secondary" rightIcon={<ChevronRight />} onClick={() => router.push(`/assessments/result/${aid}`)}>View results</Button>
                ) : null}
              </div>
            </div>
          </Card>
        )}
      </div>
    </AuthGuard>
  );
}

function MetaCell({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-5 py-3">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div><p className="ds-overline">{label}</p><p className="text-sm font-semibold text-foreground">{value}</p></div>
    </div>
  );
}
