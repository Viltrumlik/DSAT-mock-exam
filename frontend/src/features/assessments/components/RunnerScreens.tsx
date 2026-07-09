"use client";

/**
 * Presentational screens + indicators for the assessment runner.
 *
 * These are pure, stateless components extracted from StudentAttemptRunnerContainer
 * to keep the container focused on state orchestration. They receive everything
 * via props and own no attempt logic.
 */

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Send,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { spawnRipple } from "@/features/classroom/ui/ripple";
import type { AnswerConflict } from "@/features/assessments/attemptSync";
import { formatReceiptTime, readSubmitReceipt } from "@/features/assessments/attemptDraftStorage";

export type SaveState = "idle" | "saving" | "saved" | "offline" | "error";

/** Format elapsed seconds as h:mm:ss (or m:ss under an hour). */
export function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Save indicator ───────────────────────────────────────────────────────────
// Shows ambient save state without alarming the student.
// "saving" → subtle pulsing dot only (invisible unless you look)
// "saved"  → green dot + "Saved" label for 2s (reassuring, then vanishes)
// error/offline → handled by dedicated banners, not here

export function SaveDot({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span className="inline-flex items-center gap-1" aria-live="polite" aria-atomic>
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full transition-all duration-500",
          state === "saving" && "bg-muted-foreground/40 animate-pulse",
          state === "saved" && "bg-emerald-500",
          (state === "offline" || state === "error") && "bg-amber-500",
        )}
        aria-hidden
      />
      {state === "saved" && (
        <span className="text-[10px] font-semibold text-emerald-600 leading-none">
          Saved
        </span>
      )}
      {state === "saving" && (
        <span className="text-[10px] font-medium text-muted-foreground/60 leading-none">
          Saving…
        </span>
      )}
    </span>
  );
}

// ─── Question map ─────────────────────────────────────────────────────────────

export function QuestionMap({
  total,
  currentIdx,
  answeredIds,
  questionIds,
  onJump,
}: {
  total: number;
  currentIdx: number;
  answeredIds: Set<number>;
  questionIds: number[];
  onJump: (idx: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" role="navigation" aria-label="Question navigation">
      {Array.from({ length: total }).map((_, i) => {
        const qid = questionIds[i];
        const isAnswered = qid != null && answeredIds.has(qid);
        const isCurrent = i === currentIdx;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onJump(i)}
            aria-label={`Question ${i + 1}${isAnswered ? " (answered)" : ""}${isCurrent ? " (current)" : ""}`}
            className={cn(
              // h-9 w-9 = 36px — closer to 44px minimum; gap-2 adds effective touch margin
              "h-9 w-9 rounded-lg text-xs font-bold transition-all",
              isCurrent
                ? "bg-primary text-primary-foreground shadow-sm scale-110"
                : isAnswered
                ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                : "bg-surface-2 text-muted-foreground hover:bg-border",
            )}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

// ─── Conflict dialog ──────────────────────────────────────────────────────────

export function ConflictDialog({
  conflicts,
  onKeepMine,
  onUseOther,
  onKeepAllMine,
  saving,
}: {
  conflicts: AnswerConflict[];
  onKeepMine: (qid: number) => Promise<void>;
  onUseOther: (qid: number) => void;
  onKeepAllMine: () => void;
  saving: boolean;
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 space-y-4">
      <div>
        <p className="text-sm font-bold text-amber-900">
          We found answers from another session
        </p>
        <p className="text-sm text-amber-800 mt-1">
          Another device or browser tab saved different answers for{" "}
          {conflicts.length === 1 ? "1 question" : `${conflicts.length} questions`}.
          Choose which version to keep for each.
        </p>
      </div>

      <div className="space-y-2">
        {conflicts.map((c) => (
          <div
            key={c.questionId}
            className="rounded-xl border border-amber-200 bg-white p-3 flex flex-wrap items-center gap-3"
          >
            <span className="text-sm font-bold text-amber-900 shrink-0">
              Question {c.questionId}
            </span>
            <div className="flex gap-2 ml-auto">
              <button
                type="button"
                onClick={() => void onKeepMine(c.questionId)}
                disabled={saving}
                className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/15 disabled:opacity-50"
              >
                Keep mine
              </button>
              <button
                type="button"
                onClick={() => onUseOther(c.questionId)}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2"
              >
                Use other
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onKeepAllMine}
        className="text-xs font-bold text-amber-800 hover:underline"
      >
        Keep all my answers for every question →
      </button>
    </div>
  );
}

// ─── Submit confirm screen ────────────────────────────────────────────────────

export function SubmitConfirmScreen({
  title,
  answeredCount,
  totalCount,
  onConfirm,
  onBack,
}: {
  title: string;
  answeredCount: number;
  totalCount: number;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const unanswered = totalCount - answeredCount;
  const pct = totalCount ? Math.round((answeredCount / totalCount) * 100) : 0;

  return (
    <div className="w-full" style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}>
      <div className="cr-celebpop mx-auto grid w-full max-w-[720px] overflow-hidden rounded-3xl border border-border bg-card shadow-xl sm:grid-cols-[260px_1fr]">
        {/* Left progress rail — gradient, big count + meter (no ring; 1:1 with mockup) */}
        <div className="relative overflow-hidden bg-gradient-to-br from-primary to-primary-hover px-[30px] py-[38px] text-primary-foreground">
          {/* soft decorative blooms (bottom-right) */}
          <div
            className="pointer-events-none absolute -bottom-10 -right-10 h-40 w-40 rounded-full bg-primary-foreground/[0.06]"
            aria-hidden
          />

          {/* Send badge */}
          <div className="relative mb-[26px] flex h-[54px] w-[54px] items-center justify-center rounded-[15px] bg-primary-foreground/[0.16]">
            <Send className="h-6 w-6 text-primary-foreground" />
          </div>

          <p className="relative text-xs font-extrabold uppercase tracking-[0.08em] text-primary-foreground/70">
            Progress
          </p>

          {/* Big {answered} / {total} */}
          <div className="relative mt-2 flex items-baseline gap-1">
            <span className="text-[46px] font-extrabold leading-none tracking-tight tabular-nums">
              {answeredCount}
            </span>
            <span className="text-[22px] font-bold text-primary-foreground/60 tabular-nums">
              / {totalCount}
            </span>
          </div>

          <p className="relative mt-[3px] text-[13px] font-semibold text-primary-foreground/80">
            questions answered
          </p>

          {/* Thin meter bar that grows to {pct}% */}
          <div className="relative mt-[22px] h-2 overflow-hidden rounded-[5px] bg-primary-foreground/20">
            <div
              className="cr-bar h-full rounded-[5px] bg-primary-foreground"
              style={{ width: `${pct}%` }}
            />
          </div>

          <p className="relative mt-2.5 text-xs font-bold text-primary-foreground/80">
            {pct}% complete
          </p>
        </div>

        {/* Right decision column */}
        <div className="px-9 py-[38px]">
          <h2 className="text-[26px] font-extrabold tracking-tight text-foreground">
            Ready to submit?
          </h2>
          <p className="mt-1.5 text-sm font-medium text-muted-foreground">{title}</p>

          {unanswered > 0 && (
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-[13px] font-semibold leading-relaxed text-amber-700">
                <span className="font-bold">{unanswered} unanswered</span> questions
                will be marked incorrect if you submit now.
              </p>
            </div>
          )}

          <div className={cn("flex gap-3", unanswered > 0 ? "mt-7" : "mt-8")}>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={onBack}
              onPointerDown={spawnRipple}
              leftIcon={<ArrowLeft />}
              className="cr-ripple font-extrabold"
            >
              Go back
            </Button>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={onConfirm}
              onPointerDown={spawnRipple}
              rightIcon={<ArrowRight />}
              className="cr-ripple font-extrabold"
            >
              Submit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Review screen (post-submit time summary) ────────────────────────────────

export function ReviewScreen({
  title,
  assignmentId,
  homeworkId,
  questionIds,
  questionTimes,
  totalElapsed,
}: {
  title: string;
  assignmentId: number | null;
  homeworkId?: number | null;
  questionIds: number[];
  questionTimes: Record<number, number>;
  totalElapsed: number;
}) {
  const totalTracked = Object.values(questionTimes).reduce((a, b) => a + b, 0);
  const resultHref = assignmentId
    ? `/assessments/result/${assignmentId}${homeworkId ? `?homework=${homeworkId}` : ""}`
    : "/classes";
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-4">
        <div className="rounded-full bg-emerald-100 p-4 w-20 h-20 mx-auto flex items-center justify-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        </div>
        <div>
          <h2 className="text-2xl font-extrabold text-foreground">Submitted!</h2>
          <p className="text-muted-foreground mt-1">{title}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-surface-2 px-4 py-3 text-center">
            <p className="text-2xl font-extrabold text-primary tabular-nums">{fmtElapsed(totalElapsed)}</p>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-0.5">Total time</p>
          </div>
          <div className="rounded-xl bg-surface-2 px-4 py-3 text-center">
            <p className="text-2xl font-extrabold text-foreground tabular-nums">{questionIds.length}</p>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-0.5">Questions</p>
          </div>
        </div>
      </div>

      {/* Per-question time breakdown */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <h3 className="text-sm font-extrabold text-foreground uppercase tracking-wide">
          Time per question
        </h3>
        <div className="space-y-1.5">
          {questionIds.map((qid, i) => {
            const sec = questionTimes[qid] || 0;
            const pct = totalTracked > 0 ? Math.round((sec / totalTracked) * 100) : 0;
            return (
              <div key={qid} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2">
                <span className="text-xs font-bold text-muted-foreground w-6 text-right shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="h-1.5 rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/60 transition-all"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs font-bold text-foreground tabular-nums w-12 text-right shrink-0">
                  {fmtElapsed(sec)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-center gap-3">
        {assignmentId ? (
          <Link
            href={resultHref}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            View results
            <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <Link
            href="/classes"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-extrabold text-foreground hover:bg-surface-2 transition-colors"
          >
            Back to classes
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── Complete screen ──────────────────────────────────────────────────────────

export function CompleteScreen({
  title,
  assignmentId,
  homeworkId,
  attemptId,
}: {
  title: string;
  assignmentId: number | null;
  /** Targets the SPECIFIC assessment of a multi-assessment assignment bundle. */
  homeworkId?: number | null;
  attemptId: number;
}) {
  const receipt = readSubmitReceipt(attemptId);
  const timeLabel = receipt ? formatReceiptTime(receipt.ts) : null;
  const resultHref = assignmentId
    ? `/assessments/result/${assignmentId}${homeworkId ? `?homework=${homeworkId}` : ""}`
    : "/classes";
  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="rounded-2xl border border-border bg-card p-10 text-center space-y-5">
        <div className="rounded-full bg-emerald-100 p-4 w-20 h-20 mx-auto flex items-center justify-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        </div>
        <div>
          <h2 className="text-2xl font-extrabold text-foreground">Submitted</h2>
          <p className="text-muted-foreground mt-1">{title}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          {timeLabel
            ? <>Your answers were received at <span className="font-semibold text-foreground">{timeLabel}</span>. Grading is in progress.</>
            : "Your answers have been saved and submitted. Grading is in progress."
          }
        </p>
        {assignmentId ? (
          <Link
            href={resultHref}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            View results
            <ChevronRight className="h-4 w-4" />
          </Link>
        ) : (
          <Link
            href="/classes"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-extrabold text-foreground hover:bg-surface-2 transition-colors"
          >
            Back to classes
          </Link>
        )}
      </div>
    </div>
  );
}
