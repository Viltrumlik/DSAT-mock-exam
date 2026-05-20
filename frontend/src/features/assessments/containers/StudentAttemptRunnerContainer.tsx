"use client";

/**
 * StudentAttemptRunnerContainer
 *
 * The exam surface. Designed to feel calm and trustworthy under pressure.
 *
 * DESIGN PRINCIPLES:
 *   - Autosave is invisible when working. Students never wonder "did I lose my work?"
 *   - Connectivity problems are stated calmly, not technically.
 *   - Answer conflicts from other devices use plain language, not "fingerprint" concepts.
 *   - Navigation is a question map — students see their progress at a glance.
 *   - Submit is a deliberate two-step: confirm intent → calming success screen.
 *   - No exposed internals: no "reload from server", no "offline queue", no "retry payload".
 *
 * SAVE STATES (internal only, reflected via a subtle dot):
 *   idle    → dot hidden
 *   saving  → dot pulsing gray
 *   saved   → dot solid green (fades after 2s)
 *   offline → amber banner (calm, non-alarming)
 *   error   → amber banner with quiet retry
 *
 * STAGES (exam flow):
 *   exam            → normal answering
 *   confirm-submit  → "Ready to submit?" review screen
 *   submitting      → processing animation
 *   complete        → success screen with result navigation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAttemptBundle, useSaveAnswer, useSubmitAttempt } from "@/features/assessments/hooks";
import { normalizeApiError } from "@/lib/apiError";
import type { AssessmentChoice, AssessmentQuestion } from "@/features/assessments/types";
import { AnswerInput } from "@/features/assessments/components/QuestionInputs";
import { MathText } from "@/components/MathText";
import {
  answersMapFromAttempt,
  detectAnswerConflicts,
  fingerprintAnswersFromAttempt,
  type AnswerConflict,
} from "@/features/assessments/attemptSync";
import {
  clearAttemptDraftStorage,
  clearDraftMirror,
  formatReceiptTime,
  readAttemptDraftEnvelope,
  readDraftMirror,
  readSubmitReceipt,
  writeAttemptDraftEnvelope,
  writeDraftMirror,
  writeSubmitReceipt,
} from "@/features/assessments/attemptDraftStorage";
import { normalizeQuestionList } from "@/features/assessments/builder/normalize";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Monitor,
  Send,
  Timer,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

type SaveState = "idle" | "saving" | "saved" | "offline" | "error";
type Stage = "exam" | "confirm-submit" | "submitting" | "complete" | "review";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseChoices(raw: unknown): AssessmentChoice[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((x) => {
      if (!x || typeof x !== "object") return null;
      const id = String((x as Record<string, unknown>).id || "").trim();
      const text = String((x as Record<string, unknown>).text || "");
      if (!id) return null;
      return { id, text };
    })
    .filter(Boolean) as AssessmentChoice[];
}

async function backoffDelayMs(attempt: number) {
  const ms = Math.min(10_000, 600 * 2 ** attempt);
  await new Promise((r) => setTimeout(r, ms));
}

function syncFpFromAttempt(attempt: unknown): string {
  return fingerprintAnswersFromAttempt(attempt as Parameters<typeof fingerprintAnswersFromAttempt>[0]);
}

// ─── Save indicator ───────────────────────────────────────────────────────────
// Shows ambient save state without alarming the student.
// "saving" → subtle pulsing dot only (invisible unless you look)
// "saved"  → green dot + "Saved" label for 2s (reassuring, then vanishes)
// error/offline → handled by dedicated banners, not here

function SaveDot({ state }: { state: SaveState }) {
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

function QuestionMap({
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

function ConflictDialog({
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
        {conflicts.map((c, i) => (
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

function SubmitConfirmScreen({
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
  return (
    <div className="mx-auto w-full max-w-lg space-y-5">
      <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-4">
        <div className="rounded-full bg-primary/10 p-4 w-16 h-16 mx-auto flex items-center justify-center">
          <Send className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-foreground">Ready to submit?</h2>
          <p className="text-sm text-muted-foreground mt-1">{title}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-xl bg-surface-2 px-4 py-3">
            <p className="text-2xl font-extrabold text-emerald-700 tabular-nums">
              {answeredCount}
            </p>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
              Answered
            </p>
          </div>
          <div className="rounded-xl bg-surface-2 px-4 py-3">
            <p
              className={cn(
                "text-2xl font-extrabold tabular-nums",
                unanswered > 0 ? "text-amber-600" : "text-foreground",
              )}
            >
              {unanswered}
            </p>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
              Unanswered
            </p>
          </div>
        </div>

        {unanswered > 0 && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
            You have {unanswered} unanswered question
            {unanswered !== 1 ? "s" : ""}. You can go back and answer them, or
            submit now.
          </p>
        )}

        {/* Trust signal — reassure before submitting */}
        <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          Your answers are saved and will not be lost.
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
          >
            <ChevronLeft className="h-4 w-4 inline mr-1" />
            Go back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Submit
            <ChevronRight className="h-4 w-4 inline ml-1" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Elapsed time formatter ──────────────────────────────────────────────────

function fmtElapsed(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Review screen (post-submit time summary) ────────────────────────────────

function ReviewScreen({
  title,
  assignmentId,
  attemptId,
  questionIds,
  questionTimes,
  totalElapsed,
}: {
  title: string;
  assignmentId: number | null;
  attemptId: number;
  questionIds: number[];
  questionTimes: Record<number, number>;
  totalElapsed: number;
}) {
  const totalTracked = Object.values(questionTimes).reduce((a, b) => a + b, 0);
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
          <a
            href={`/assessments/result/${assignmentId}`}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            View results
            <ChevronRight className="h-4 w-4" />
          </a>
        ) : (
          <a
            href="/classes"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-extrabold text-foreground hover:bg-surface-2 transition-colors"
          >
            Back to classes
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Complete screen ──────────────────────────────────────────────────────────

function CompleteScreen({
  title,
  assignmentId,
  attemptId,
}: {
  title: string;
  assignmentId: number | null;
  attemptId: number;
}) {
  const receipt = readSubmitReceipt(attemptId);
  const timeLabel = receipt ? formatReceiptTime(receipt.ts) : null;
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
          <a
            href={`/assessments/result/${assignmentId}`}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            View results
            <ChevronRight className="h-4 w-4" />
          </a>
        ) : (
          <a
            href="/classes"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-extrabold text-foreground hover:bg-surface-2 transition-colors"
          >
            Back to classes
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Main container ───────────────────────────────────────────────────────────

export default function StudentAttemptRunnerContainer({ attemptId }: { attemptId: number }) {
  const { data, isLoading, error, refetch } = useAttemptBundle(attemptId);
  const save = useSaveAnswer();
  const submit = useSubmitAttempt();

  const attempt = data?.attempt as Record<string, unknown> | undefined;
  const set = data?.set as Record<string, unknown> | undefined;
  const questions = (
    Array.isArray(data?.questions) ? data!.questions : []
  ) as AssessmentQuestion[];
  // assignment_id is the outer classes.Assignment PK, used for result URL
  const assignmentId = (data as Record<string, unknown> | undefined)?.assignment_id as
    | number
    | null
    | undefined;
  // Pedagogical context: classroom + assignment title from the bundle meta block.
  // Renders in the runner header so students always know which classroom this
  // assessment belongs to. Gracefully absent for older bundles without meta.
  const runnerMeta = (data as Record<string, unknown> | undefined)?.meta as
    | { classroom_name?: string | null; assignment_title?: string | null; due_at?: string | null }
    | undefined;

  const ordered = useMemo(() => normalizeQuestionList(questions), [questions]);
  const questionIds = useMemo(
    () => ordered.map((q) => Number((q as Record<string, unknown>).id || 0)),
    [ordered],
  );

  const initialByQid = useMemo(() => answersMapFromAttempt(attempt), [attempt]);

  // ── Exam state ──────────────────────────────────────────────────────────────
  const [stage, setStage] = useState<Stage>("exam");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [draftById, setDraftById] = useState<Record<number, unknown>>({});
  const [draftRestoredBanner, setDraftRestoredBanner] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [conflicts, setConflicts] = useState<AnswerConflict[]>([]);
  const [justReconnected, setJustReconnected] = useState(false);
  // True when another tab has active ownership of this attempt
  const [isPassive, setIsPassive] = useState(false);
  // Ref mirror of isPassive so lease-heartbeat closure can read current value
  const isPassiveRef = useRef(false);
  isPassiveRef.current = isPassive;

  // Guards against concurrent submit calls (fast double-tap, slow network).
  // Set to true on first call; only reset on failure to allow the student to retry.
  const submitInflightRef = useRef(false);

  // Auto-hide "saved" dot after 2s
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Count-up timer & per-question time tracking ────────────────────────────
  const examStartRef = useRef(Date.now());
  const [elapsedSec, setElapsedSec] = useState(0);
  // Accumulated seconds per question id
  const questionTimesRef = useRef<Record<number, number>>({});
  // Timestamp when the student entered the current question
  const currentQuestionStartRef = useRef(Date.now());

  // Count-up timer: tick every second while the exam stage is active
  useEffect(() => {
    if (stage !== "exam") return;
    const iv = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - examStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [stage]);

  const current = ordered[currentIdx] as Record<string, unknown> | undefined;
  const currentQuestionId = Number(current?.id || 0);

  // Track per-question time when switching questions
  const prevIdxRef = useRef(currentIdx);
  useEffect(() => {
    if (prevIdxRef.current !== currentIdx) {
      // Accumulate time for the previous question
      const prevQid = questionIds[prevIdxRef.current];
      if (prevQid) {
        const spent = Math.floor((Date.now() - currentQuestionStartRef.current) / 1000);
        questionTimesRef.current[prevQid] = (questionTimesRef.current[prevQid] || 0) + spent;
      }
      currentQuestionStartRef.current = Date.now();
      prevIdxRef.current = currentIdx;
    }
  }, [currentIdx, questionIds]);

  const draftRef = useRef(draftById);
  draftRef.current = draftById;
  const prevServerFpRef = useRef<string | null>(null);
  const lastSavedFpRef = useRef<string | null>(null);

  // Declared here so draft-persistence effects can reference it
  const offlineQueue = useRef<Record<number, unknown>>({});
  // Stable refs so event listeners always call the latest callbacks / read latest state
  const flushSaveRef = useRef<(() => Promise<void>) | null>(null);
  const refetchRef = useRef(refetch);
  const stageRef = useRef(stage);
  refetchRef.current = refetch;
  stageRef.current = stage;

  // ── Draft persistence ───────────────────────────────────────────────────────

  useEffect(() => {
    const env = readAttemptDraftEnvelope(attemptId);
    const hasPrimary = env?.drafts && Object.keys(env.drafts).length > 0;

    if (hasPrimary && env) {
      setDraftById(env.drafts);
      // Show a brief "answers restored" banner so the student knows their
      // work survived the page refresh / tab kill. Auto-dismisses after 4s.
      setDraftRestoredBanner(true);
      const t = setTimeout(() => setDraftRestoredBanner(false), 4000);
      // Restore any pending (unsaved) qids into the offline queue so they retry
      if (env.pendingQids && env.pendingQids.length > 0) {
        for (const qid of env.pendingQids) {
          if (env.drafts[qid] !== undefined) {
            offlineQueue.current[qid] = env.drafts[qid];
          }
        }
      }
      return () => clearTimeout(t);
    }

    // ── sessionStorage fallback ──────────────────────────────────────────────
    // localStorage was empty or unavailable (Safari private browsing, quota
    // exceeded after eviction, restricted contexts). Try the same-tab mirror
    // written to sessionStorage on the last save — survives page refreshes
    // within the same tab even when the primary store fails.
    const mirror = readDraftMirror(attemptId);
    if (mirror && Object.keys(mirror).length > 0) {
      setDraftById(mirror);
      setDraftRestoredBanner(true);
      const t = setTimeout(() => setDraftRestoredBanner(false), 4000);
      return () => clearTimeout(t);
    }

    // Restore any pending (unsaved) qids even when no draft keys changed
    if (env?.pendingQids && env.pendingQids.length > 0 && env.drafts) {
      for (const qid of env.pendingQids) {
        if (env.drafts[qid] !== undefined) {
          offlineQueue.current[qid] = env.drafts[qid];
        }
      }
    }
  }, [attemptId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDraftById((prev) => ({ ...initialByQid, ...prev }));
  }, [initialByQid]);

  useEffect(() => {
    // Snapshot the offline queue qids for persistence
    const pendingQids = Object.keys(offlineQueue.current).map(Number).filter(Number.isFinite);
    writeAttemptDraftEnvelope(attemptId, {
      v: 2,
      drafts: draftById,
      savedFingerprint: lastSavedFpRef.current,
      pendingQids,
    });
    // Mirror to sessionStorage as a fallback for the primary localStorage store.
    // If localStorage quota is exceeded or unavailable (Safari private, restricted
    // contexts), the in-session copy keeps drafts safe through same-tab reloads.
    writeDraftMirror(attemptId, draftById);
  }, [attemptId, draftById]);

  // ── Server-side conflict detection ─────────────────────────────────────────

  const applyServerFp = useCallback((nextAttempt: unknown) => {
    const fp = syncFpFromAttempt(nextAttempt);
    prevServerFpRef.current = fp;
    lastSavedFpRef.current = fp;
  }, []);

  useEffect(() => {
    if (!attempt) return;
    const fp = syncFpFromAttempt(attempt);
    if (prevServerFpRef.current === null) {
      prevServerFpRef.current = fp;
      lastSavedFpRef.current = fp;
      return;
    }
    if (fp === prevServerFpRef.current) return;
    prevServerFpRef.current = fp;
    const serverMap = answersMapFromAttempt(attempt);
    const next = detectAnswerConflicts(draftRef.current, serverMap);
    if (next.length) {
      setConflicts(next);
    } else {
      setConflicts([]);
      applyServerFp(attempt);
    }
  }, [attempt, applyServerFp]);

  // ── Online/offline ──────────────────────────────────────────────────────────

  useEffect(() => {
    const reconnectTimer = { current: null as ReturnType<typeof setTimeout> | null };
    const up = () => {
      setOnline(true);
      setSaveState((s) => (s === "offline" ? "idle" : s));
      setJustReconnected(true);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(() => setJustReconnected(false), 3000);
      // Flush answers queued while offline
      void flushSaveRef.current?.();
      // Then refetch attempt state — covers "did the submit land while offline?"
      // and re-checks attempt.status so the correct screen shows automatically.
      setTimeout(() => {
        void refetchRef.current().then((r: { data?: unknown }) => {
          const status = ((r.data as Record<string, unknown> | undefined)?.attempt as Record<string, unknown> | undefined)?.status;
          if (status === "submitted" && stageRef.current !== "complete" && stageRef.current !== "submitting") {
            setStage("complete");
          }
        });
      }, 500); // short delay so flush completes first
    };
    const down = () => {
      setOnline(false);
      setSaveState("offline");
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // ── beforeunload guard (desktop) ────────────────────────────────────────────
  // Show the browser "Leave site?" dialog when a save is in-flight or the
  // offline queue has unsaved answers. Mobile browsers ignore beforeunload.

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      // After a successful submit the student should navigate freely to results.
      // Also suppressed once submitInflightRef is true (submit in progress) since
      // the submit API call itself will persist the work server-side.
      if (stage === "complete" || stage === "submitting") return;
      const hasPending = Object.keys(offlineQueue.current).length > 0;
      if (saveState === "saving" || hasPending) {
        e.preventDefault();
        // Modern browsers show their own message; returnValue triggers the dialog
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState, stage]);

  // ── Duplicate-tab ownership (localStorage lease) ───────────────────────────
  // One tab "owns" the attempt at a time. Other tabs go passive to prevent
  // competing autosaves. The owner heartbeats every 5s. If the owner tab closes
  // or the lease expires (>12s), the passive tab acquires ownership silently.
  // No technical language exposed to students.

  // Tab ID: persisted in sessionStorage (survives soft reload, unique per tab).
  // Full try/catch guards against private-browsing storage restrictions.
  const tabId = useRef((() => {
    try {
      const existing = sessionStorage.getItem("_tab_id");
      if (existing) return existing;
      const id = Math.random().toString(36).slice(2);
      sessionStorage.setItem("_tab_id", id);
      return id;
    } catch {
      return Math.random().toString(36).slice(2);
    }
  })());

  useEffect(() => {
    const leaseKey = `attempt_owner_${attemptId}`;
    const LEASE_TTL = 12_000;
    const HEARTBEAT = 5_000;

    const readLease = (): { tabId: string; ts: number } | null => {
      try {
        const raw = localStorage.getItem(leaseKey);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };

    const writeLease = () => {
      try {
        localStorage.setItem(leaseKey, JSON.stringify({ tabId: tabId.current, ts: Date.now() }));
      } catch { /* quota — non-fatal */ }
    };

    const releaseLease = () => {
      try {
        const lease = readLease();
        if (lease?.tabId === tabId.current) localStorage.removeItem(leaseKey);
      } catch { /* non-fatal */ }
    };

    const tryAcquire = () => {
      const lease = readLease();
      const now = Date.now();
      if (!lease || lease.tabId === tabId.current || (now - lease.ts) > LEASE_TTL) {
        writeLease();
        setIsPassive(false);
        return true;
      }
      setIsPassive(true);
      return false;
    };

    // Initial acquisition attempt
    tryAcquire();

    // Heartbeat: active tab refreshes lease; passive tab polls to take over if owner left
    let passivePollTick = 0;
    const interval = setInterval(() => {
      const lease = readLease();
      if (!lease || lease.tabId === tabId.current) {
        // We own or lease disappeared — refresh / acquire
        writeLease();
        setIsPassive(false);
        passivePollTick = 0;
      } else if ((Date.now() - lease.ts) > LEASE_TTL) {
        // Lease expired — acquire ownership
        tryAcquire();
        passivePollTick = 0;
      } else {
        // Another tab owns a fresh lease — stay passive.
        // Every ~30s (6 × 5s heartbeats), poll the server to detect if the
        // active tab submitted. If so, advance this tab to the complete screen
        // so the student isn't left staring at a frozen read-only exam.
        passivePollTick++;
        if (passivePollTick >= 6) {
          passivePollTick = 0;
          void refetchRef.current().then((r: { data?: unknown }) => {
            const status = (
              (r.data as Record<string, unknown> | undefined)?.attempt as Record<string, unknown> | undefined
            )?.status;
            if (status === "submitted" && stageRef.current !== "complete") {
              setStage("complete");
              setIsPassive(false);
            }
          });
        }
      }
    }, HEARTBEAT);

    // React immediately when another tab modifies the lease key
    const onStorage = (e: StorageEvent) => {
      if (e.key === leaseKey) tryAcquire();
    };
    window.addEventListener("storage", onStorage);

    // When this tab returns from background, re-check ownership immediately.
    // Fixes the suspended-timer race: iOS/Chrome pause setInterval on backgrounded
    // tabs, so a heartbeat may have lapsed even though this tab is still "alive".
    // On visibility restore, we assert or re-acquire before the user can interact.
    const onVisibilityForLease = () => {
      if (!document.hidden) tryAcquire();
    };
    document.addEventListener("visibilitychange", onVisibilityForLease);

    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityForLease);
      releaseLease();
    };
  }, [attemptId]);

  // ── Visibility-change refetch (long-idle tab restoration) ──────────────────
  // When a tab comes back from being hidden for >2 minutes (iOS memory pressure,
  // backgrounded Android, long-idle desktop tab), refetch to check whether the
  // attempt has been submitted elsewhere or state has drifted.

  useEffect(() => {
    let hiddenAt: number | null = null;
    const STALE_THRESHOLD = 2 * 60 * 1000; // 2 minutes

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        const elapsed = Date.now() - hiddenAt;
        hiddenAt = null;
        if (elapsed > STALE_THRESHOLD) {
          // Tab was away long enough that state may have drifted — re-sync
          void refetchRef.current().then((r: { data?: unknown }) => {
            const status = ((r.data as Record<string, unknown> | undefined)?.attempt as Record<string, unknown> | undefined)?.status;
            if (
              status === "submitted" &&
              stageRef.current !== "complete" &&
              stageRef.current !== "submitting"
            ) {
              setStage("complete");
            }
          });
        }
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // ── Autosave ────────────────────────────────────────────────────────────────

  const debouncedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEnqueued = useRef<{ qid: number; value: unknown } | null>(null);

  const showSaved = () => {
    setSaveState("saved");
    setSaveError(null);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaveState("idle"), 2000);
  };

  const flushSave = useCallback(async () => {
    if (conflicts.length) return; // wait for conflict resolution

    // Flush offline queue first
    if (online) {
      const queuedIds = Object.keys(offlineQueue.current)
        .map(Number)
        .filter(Number.isFinite);
      if (queuedIds.length) {
        setSaveState("saving");
        for (const qid of queuedIds) {
          const v = offlineQueue.current[qid];
          let ok = false;
          for (let a = 0; a < 4; a++) {
            try {
              await save.mutateAsync({ attempt_id: attemptId, question_id: qid, answer: v });
              const fr = await refetch();
              if (fr.data?.attempt) applyServerFp(fr.data.attempt);
              setConflicts([]);
              ok = true;
              break;
            } catch (e) {
              const ax = normalizeApiError(e);
              if (ax.status === 401) {
                setSaveState("error");
                setSaveError("Your session has expired. Your answers are saved locally — please sign in again.");
                return;
              }
              if (![0, 429, 503].includes(ax.status ?? 0) || a === 3) break;
              await backoffDelayMs(a);
            }
          }
          if (ok) {
            delete offlineQueue.current[qid];
          } else {
            setSaveState("error");
            setSaveError("Some answers couldn't sync. They're saved locally and will retry.");
            return;
          }
        }
      }
    }

    const x = lastEnqueued.current;
    if (!x) return;
    lastEnqueued.current = null;

    for (let a = 0; a < 4; a++) {
      try {
        await save.mutateAsync({ attempt_id: attemptId, question_id: x.qid, answer: x.value });
        const fr = await refetch();
        if (fr.data?.attempt) applyServerFp(fr.data.attempt);
        setConflicts([]);
        showSaved();
        return;
      } catch (e) {
        const ax = normalizeApiError(e);
        if (ax.status === 401) {
          setSaveState("error");
          setSaveError("Your session has expired. Your answers are saved locally — please sign in again.");
          return;
        }
        if (![0, 429, 503].includes(ax.status ?? 0) || a === 3) {
          setSaveState("error");
          setSaveError("Couldn't save your answer. It's stored locally and will retry.");
          return;
        }
        await backoffDelayMs(a);
      }
    }
  }, [conflicts.length, online, attemptId, save, refetch, applyServerFp]);

  // Keep the ref in sync so the online-event handler always calls the latest version
  flushSaveRef.current = flushSave;

  const enqueueSave = useCallback(
    (qid: number, value: unknown) => {
      if (!online) {
        offlineQueue.current[qid] = value;
        setSaveState("offline");
        return;
      }
      if (conflicts.length) return;
      lastEnqueued.current = { qid, value };
      setSaveState("saving");
      if (debouncedTimer.current) clearTimeout(debouncedTimer.current);
      debouncedTimer.current = setTimeout(() => void flushSave(), 650);
    },
    [online, conflicts.length, flushSave],
  );

  // ── Conflict resolution ─────────────────────────────────────────────────────

  const resolveKeepMine = useCallback(
    async (qid: number) => {
      const row = conflicts.find((c) => c.questionId === qid);
      if (!row) return;
      try {
        setSaveState("saving");
        await save.mutateAsync({ attempt_id: attemptId, question_id: qid, answer: row.local });
        const fr = await refetch();
        const next = { ...draftRef.current, [qid]: row.local };
        setDraftById(next);
        const still = detectAnswerConflicts(next, answersMapFromAttempt(fr.data?.attempt));
        setConflicts(still);
        if (fr.data?.attempt) applyServerFp(fr.data.attempt);
        showSaved();
      } catch {
        setSaveState("error");
        setSaveError("Couldn't save. Try again.");
      }
    },
    [conflicts, attemptId, save, refetch, applyServerFp],
  );

  const resolveUseOther = useCallback(
    (qid: number) => {
      const row = conflicts.find((c) => c.questionId === qid);
      if (!row || !attempt) return;
      const next = { ...draftRef.current, [qid]: row.remote };
      setDraftById(next);
      draftRef.current = next;
      const serverMap = answersMapFromAttempt(attempt);
      const still = detectAnswerConflicts(next, serverMap);
      setConflicts(still);
      if (!still.length) applyServerFp(attempt);
    },
    [conflicts, attempt, applyServerFp],
  );

  const resolveKeepAllMine = useCallback(() => {
    if (!attempt) return;
    // Push all "mine" values to the server sequentially
    for (const c of conflicts) {
      lastEnqueued.current = { qid: c.questionId, value: c.local };
    }
    setConflicts([]);
    void flushSave();
  }, [conflicts, attempt, flushSave]);

  // ── Answered tracking ───────────────────────────────────────────────────────

  const answeredIds = useMemo(() => {
    const s = new Set<number>();
    for (const qid of questionIds) {
      const v = draftById[qid];
      if (v != null && String(v).trim() !== "") s.add(qid);
    }
    return s;
  }, [draftById, questionIds]);

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmitConfirm = async () => {
    // Double-submit guard: fast double-tap or slow-network re-tap should never
    // fire two simultaneous mutateAsync calls. The ref is reset only on failure
    // so the student can retry; on success it stays true for the session.
    if (submitInflightRef.current) return;
    if (conflicts.length) {
      setSubmitError("Please resolve the answer conflict above before submitting.");
      return;
    }
    submitInflightRef.current = true;
    // Finalize the current question's time before submitting
    if (currentQuestionId) {
      const spent = Math.floor((Date.now() - currentQuestionStartRef.current) / 1000);
      questionTimesRef.current[currentQuestionId] = (questionTimesRef.current[currentQuestionId] || 0) + spent;
    }
    setStage("submitting");
    setSubmitError(null);
    try {
      if (debouncedTimer.current) clearTimeout(debouncedTimer.current);
      await flushSave();
      const submitResponse = await submit.mutateAsync({ attempt_id: attemptId });
      // Use server-authoritative submitted_at so the receipt timestamp matches
      // what the server recorded, even if the client clock drifted.
      const serverSubmittedAt = submitResponse?.attempt?.submitted_at
        ? new Date(submitResponse.attempt.submitted_at).getTime()
        : null;
      clearAttemptDraftStorage(attemptId);
      clearDraftMirror(attemptId);
      writeSubmitReceipt(attemptId, assignmentId ?? null, serverSubmittedAt);
      setStage("review");
      // Notify parent page (backward compat for any listeners)
      window.dispatchEvent(
        new CustomEvent("assessment:submitted", { detail: { attemptId } }),
      );
      // submitInflightRef intentionally stays true — successful submit should
      // never be re-fired even if the user navigates back to this surface.
    } catch (e) {
      submitInflightRef.current = false; // allow student to retry
      setStage("confirm-submit");
      const ax = normalizeApiError(e);
      setSubmitError(
        ax.status === 401
          ? "Your session has expired. Your answers are saved locally — please sign in again."
          : (ax.status === 0
            ? "Your answers are saved — try submitting again when your connection is stable."
            : ax.message)
      );
    }
  };

  // ── Loading / error states ──────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div className="rounded-2xl border border-border bg-card p-5 animate-pulse h-24" />
        <div className="rounded-2xl border border-border bg-card p-5 animate-pulse h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-3">
          <p className="font-extrabold text-foreground">Couldn't load this assessment</p>
          <p className="text-sm text-muted-foreground">
            {String((error as { message?: string })?.message || "Unknown error")}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-extrabold hover:bg-surface-2"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── Already-submitted guard ─────────────────────────────────────────────────
  // If the server says this attempt is already submitted and we're not in the
  // complete/submitting stage, show a calm "already done" screen rather than
  // the exam form. This handles: duplicate tabs, back-navigation after submit,
  // and iOS kill/restore after successful submit.
  if (
    attempt?.status === "submitted" &&
    stage !== "complete" &&
    stage !== "submitting"
  ) {
    const alreadyReceipt = readSubmitReceipt(attemptId);
    const alreadyTimeLabel = alreadyReceipt ? formatReceiptTime(alreadyReceipt.ts) : null;
    return (
      <div className="mx-auto w-full max-w-lg">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
          <p className="font-extrabold text-foreground">You already submitted this assessment</p>
          <p className="text-sm text-muted-foreground">
            {alreadyTimeLabel
              ? <>Submitted at <span className="font-semibold text-foreground">{alreadyTimeLabel}</span>. Your answers have been recorded.</>
              : "Your answers have been recorded. You can view your results below."
            }
          </p>
          {assignmentId ? (
            <a
              href={`/assessments/result/${assignmentId}`}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              View results
            </a>
          ) : (
            <a
              href="/classes"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
            >
              Back to classes
            </a>
          )}
        </div>
      </div>
    );
  }

  // ── Passive-tab: read-only exam view ───────────────────────────────────────
  // Another tab owns the write lock. Show the exam in view-only mode so students
  // can review their answers without competing autosaves. Navigation still works.
  // The tab silently self-activates when the owner tab closes.
  if (isPassive) {
    const _passiveTitle = String(set?.title || "Assessment");
    const _passiveTotal = ordered.length;
    const _passiveAnswered = answeredIds.size;
    const _passiveAnswer = currentQuestionId ? draftById[currentQuestionId] : null;
    return (
      <div className="mx-auto w-full max-w-4xl space-y-3">
        {/* View-only notice — calm, not alarming */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center gap-2">
          <Monitor className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm font-semibold text-amber-800">
            Viewing in read-only mode — this exam is active in another tab. Answers cannot be changed here.
          </p>
        </div>

        {/* Header */}
        <div className="rounded-2xl border border-border bg-card px-5 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            {runnerMeta?.classroom_name && (
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] truncate mb-0.5">
                {runnerMeta.classroom_name}
              </p>
            )}
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary truncate">
              {set?.subject ? String(set.subject) : "Assessment"}
            </p>
            <p className="font-extrabold text-foreground text-base leading-tight truncate">
              {_passiveTitle}
            </p>
          </div>
          <span className="text-sm font-bold text-muted-foreground tabular-nums shrink-0">
            {_passiveAnswered}/{_passiveTotal}
          </span>
        </div>

        {/* Question map — navigation works in passive mode */}
        <div className="rounded-2xl border border-border bg-card px-5 py-3">
          <QuestionMap
            total={_passiveTotal}
            currentIdx={currentIdx}
            answeredIds={answeredIds}
            questionIds={questionIds}
            onJump={setCurrentIdx}
          />
        </div>

        {/* Question card — non-interactive */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
            Question {currentIdx + 1} of {_passiveTotal}
          </p>
          {Boolean(current?.question_prompt) && (
            <div className="mb-4 border-l-4 border-primary/40 pl-4 py-1 bg-surface-2/50 rounded-r-xl">
              <MathText
                text={String(current!.question_prompt)}
                block
                className="text-sm text-foreground leading-relaxed font-[Georgia,serif] italic"
              />
            </div>
          )}
          <MathText
            text={String(current?.prompt || "").trim() || "—"}
            block
            className="text-base font-semibold text-foreground leading-relaxed"
          />
          <div className="mt-5 pointer-events-none select-none opacity-75">
            <AnswerInput
              type={String(current?.question_type || "") as import("@/features/assessments/types").AssessmentQuestionType}
              choices={parseChoices(current?.choices)}
              value={_passiveAnswer}
              onChange={() => {/* read-only */}}
            />
          </div>
        </div>

        {/* Navigation — browse only, no submit */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
            disabled={currentIdx === 0}
            className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-4 py-3 min-h-[44px] text-sm font-bold text-foreground hover:bg-surface-2 disabled:opacity-40 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <button
            type="button"
            onClick={() => setCurrentIdx((i) => Math.min(_passiveTotal - 1, i + 1))}
            disabled={currentIdx >= _passiveTotal - 1}
            className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-4 py-3 min-h-[44px] text-sm font-bold text-foreground hover:bg-surface-2 disabled:opacity-40 transition-colors"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // ── Timed-out / expired attempt ─────────────────────────────────────────────
  if (attempt?.status === "timed_out" || attempt?.status === "expired") {
    return (
      <div className="mx-auto w-full max-w-lg">
        <div className="rounded-2xl border border-border bg-card p-8 text-center space-y-3">
          <p className="font-extrabold text-foreground">This exam session has ended</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The time window for this assessment has closed. Your answers up to that point have been recorded.
          </p>
          {assignmentId ? (
            <a
              href={`/assessments/result/${assignmentId}`}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              View results
            </a>
          ) : (
            <a
              href="/classes"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
            >
              Back to classes
            </a>
          )}
        </div>
      </div>
    );
  }

  if (!current && stage === "exam") {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-extrabold text-foreground">No questions in this assessment.</p>
        </div>
      </div>
    );
  }

  const setTitle = String(set?.title || "Assessment");
  const totalCount = ordered.length;
  const answeredCount = answeredIds.size;
  const answerValue = currentQuestionId ? draftById[currentQuestionId] : null;

  // ── Stage: review (time summary after submit) ──────────────────────────────
  if (stage === "review") {
    return (
      <ReviewScreen
        title={setTitle}
        assignmentId={assignmentId ?? null}
        attemptId={attemptId}
        questionIds={questionIds}
        questionTimes={{ ...questionTimesRef.current }}
        totalElapsed={elapsedSec}
      />
    );
  }

  // ── Stage: complete ─────────────────────────────────────────────────────────
  if (stage === "complete") {
    return (
      <CompleteScreen
        title={setTitle}
        assignmentId={assignmentId ?? null}
        attemptId={attemptId}
      />
    );
  }

  // ── Stage: submitting ───────────────────────────────────────────────────────
  if (stage === "submitting") {
    return (
      <div className="mx-auto w-full max-w-lg">
        <div className="rounded-2xl border border-border bg-card p-12 text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="font-extrabold text-foreground">Submitting your answers…</p>
          <p className="text-sm text-muted-foreground">This only takes a moment.</p>
        </div>
      </div>
    );
  }

  // ── Stage: confirm-submit ───────────────────────────────────────────────────
  if (stage === "confirm-submit") {
    return (
      <div className="space-y-4">
        <SubmitConfirmScreen
          title={setTitle}
          answeredCount={answeredCount}
          totalCount={totalCount}
          onConfirm={() => void handleSubmitConfirm()}
          onBack={() => setStage("exam")}
        />
        {submitError && (
          <div className="mx-auto w-full max-w-lg rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {submitError}
          </div>
        )}
      </div>
    );
  }

  // ── Stage: exam ─────────────────────────────────────────────────────────────
  return (
    // pb-20 on mobile creates breathing room below the sticky nav bar so the
    // bottom of the question card is never obscured. sm:pb-0 removes it on
    // wider layouts where the nav is static.
    <div className="mx-auto w-full max-w-4xl space-y-3 pb-20 sm:pb-0">

      {/* ── Offline banner (calm, not alarming) ───────────────────────────── */}
      {!online && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center gap-2">
          <WifiOff className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm font-semibold text-amber-800">
            Working offline — your answers are saved locally and will sync when you reconnect.
          </p>
        </div>
      )}

      {/* ── Draft restored (auto-dismisses after 4s) ─────────────────────── */}
      {draftRestoredBanner && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2.5 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-sky-600 shrink-0" />
          <p className="text-sm font-semibold text-sky-800">
            Your answers from your last session have been restored.
          </p>
        </div>
      )}

      {/* ── Reconnected confirmation (auto-dismisses) ─────────────────────── */}
      {online && justReconnected && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 flex items-center gap-2">
          <Wifi className="h-4 w-4 text-emerald-600 shrink-0" />
          <p className="text-sm font-semibold text-emerald-800">
            Reconnected — syncing your answers now.
          </p>
        </div>
      )}

      {/* ── Save error (quiet, non-alarming) ──────────────────────────────── */}
      {saveState === "error" && saveError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-amber-800">{saveError}</p>
          <button
            type="button"
            onClick={() => void flushSave()}
            className="text-xs font-bold text-amber-700 hover:underline whitespace-nowrap"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Conflict resolution ────────────────────────────────────────────── */}
      {conflicts.length > 0 && (
        <ConflictDialog
          conflicts={conflicts}
          onKeepMine={resolveKeepMine}
          onUseOther={resolveUseOther}
          onKeepAllMine={resolveKeepAllMine}
          saving={save.isPending}
        />
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card px-5 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Classroom context line — only rendered when meta is available */}
          {runnerMeta?.classroom_name && (
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] truncate mb-0.5">
              {runnerMeta.classroom_name}
            </p>
          )}
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary truncate">
            {set?.subject ? String(set.subject) : "Assessment"}
          </p>
          <p className="font-extrabold text-foreground text-base leading-tight truncate">
            {setTitle}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Elapsed timer */}
          <div className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1">
            <Timer className="h-3.5 w-3.5 text-primary/70" aria-hidden />
            <span className="text-sm font-bold text-foreground tabular-nums">{fmtElapsed(elapsedSec)}</span>
          </div>
          {/* Connectivity dot (only when online and working) */}
          {online && <Wifi className="h-3.5 w-3.5 text-muted-foreground/40" aria-hidden />}
          {/* Save state dot */}
          <SaveDot state={saveState} />
          <span className="text-sm font-bold text-muted-foreground tabular-nums">
            {answeredCount}/{totalCount}
          </span>
        </div>
      </div>

      {/* ── Question map ──────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card px-5 py-3">
        <QuestionMap
          total={totalCount}
          currentIdx={currentIdx}
          answeredIds={answeredIds}
          questionIds={questionIds}
          onJump={setCurrentIdx}
        />
      </div>

      {/* ── Question card ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Question {currentIdx + 1} of {totalCount}
          </p>
          <div className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span className="tabular-nums">
              {fmtElapsed(
                (questionTimesRef.current[currentQuestionId] || 0) +
                Math.floor((Date.now() - currentQuestionStartRef.current) / 1000)
              )}
            </span>
          </div>
        </div>
        {Boolean(current?.question_prompt) && (
          // On mobile: cap the passage height and make it scrollable so the
          // question stem + answer choices stay reachable without full-page scroll.
          // On wider screens: remove the cap (full passage visible).
          <div className="mb-4 border-l-4 border-primary/40 pl-4 py-1 bg-surface-2/50 rounded-r-xl max-h-48 overflow-y-auto sm:max-h-none sm:overflow-visible">
            <MathText
              text={String(current!.question_prompt)}
              block
              className="text-sm text-foreground leading-relaxed font-[Georgia,serif] italic"
            />
          </div>
        )}
        <MathText
          text={String(current?.prompt || "").trim() || "—"}
          block
          className="text-base font-semibold text-foreground leading-relaxed"
        />
        <div className="mt-5">
          <AnswerInput
            type={String(current?.question_type || "") as import("@/features/assessments/types").AssessmentQuestionType}
            choices={parseChoices(current?.choices)}
            value={answerValue}
            onChange={(next) => {
              setDraftById((prev) => ({ ...prev, [currentQuestionId]: next }));
              enqueueSave(currentQuestionId, next);
            }}
          />
        </div>
      </div>

      {/* ── Navigation + submit ───────────────────────────────────────────── */}
      {/* sticky bottom-0 on mobile keeps buttons always reachable on long questions */}
      <div className="flex items-center justify-between gap-3 sticky bottom-0 sm:static bg-background/95 sm:bg-transparent pb-safe py-2 sm:py-0 -mx-4 sm:mx-0 px-4 sm:px-0 border-t border-border sm:border-t-0">
        <button
          type="button"
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
          disabled={currentIdx === 0}
          className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-4 py-3 min-h-[44px] text-sm font-bold text-foreground hover:bg-surface-2 disabled:opacity-40 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>

        {currentIdx < totalCount - 1 ? (
          <button
            type="button"
            onClick={() => setCurrentIdx((i) => Math.min(totalCount - 1, i + 1))}
            className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-4 py-3 min-h-[44px] text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (conflicts.length) {
                setSubmitError("Please resolve the answer conflict above before submitting.");
                return;
              }
              setStage("confirm-submit");
            }}
            disabled={conflicts.length > 0}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 min-h-[44px] text-sm font-extrabold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Send className="h-4 w-4" />
            Review & Submit
          </button>
        )}
      </div>

      {/* Submit shortcut (visible on all pages after question 3) */}
      {currentIdx < totalCount - 1 && totalCount > 1 && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => {
              if (conflicts.length) return;
              setStage("confirm-submit");
            }}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            Done answering? Review & submit →
          </button>
        </div>
      )}
    </div>
  );
}
