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
import { AnswerInput, type OptionImageMap } from "@/features/assessments/components/QuestionInputs";
import {
  SaveDot,
  QuestionMap,
  ConflictDialog,
  SubmitConfirmScreen,
  CompleteScreen,
  fmtElapsed,
  type SaveState,
} from "@/features/assessments/components/RunnerScreens";
import { resolveImageUrl } from "@/features/testing-simulation/utils/image";
import { useFullscreen } from "@/features/testing-simulation/tools/useFullscreen";
import { FullscreenWarning } from "@/features/testing-simulation/components/FullscreenWarning";
import { MathText } from "@/components/MathText";
import { processInstructionalText } from "@/lib/assessmentText";
import StableHtml from "@/features/assessments/components/StableHtml";
import { useAnnotator } from "@/features/testing-simulation/tools/highlight/useAnnotator";
import { AnnotationToolbar } from "@/features/testing-simulation/tools/highlight/AnnotationToolbar";
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
import {
  CheckCircle2,
  ChevronLeft,
  AlertTriangle,
  ChevronRight,
  ChevronUp,
  Clock,
  Highlighter,
  Loader2,
  Monitor,
  Send,
  Timer,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = "exam" | "confirm-submit" | "submitting" | "complete" | "version-conflict";

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

/** Resolve the question's stem figure (relative media path) to a full URL, if any. */
function questionFigureUrl(q: Record<string, unknown> | null | undefined): string | undefined {
  return resolveImageUrl((q?.question_image as string | null | undefined) ?? null);
}

/** Build the per-choice answer-image map (A–D) the runner passes to AnswerInput. */
function optionImagesFromQuestion(q: Record<string, unknown> | null | undefined): OptionImageMap {
  if (!q) return {};
  const pick = (k: string) => (q[k] as string | null | undefined) ?? null;
  return {
    A: pick("option_a_image"),
    B: pick("option_b_image"),
    C: pick("option_c_image"),
    D: pick("option_d_image"),
  };
}

async function backoffDelayMs(attempt: number) {
  const ms = Math.min(10_000, 600 * 2 ** attempt);
  await new Promise((r) => setTimeout(r, ms));
}

function syncFpFromAttempt(attempt: unknown): string {
  return fingerprintAnswersFromAttempt(attempt as Parameters<typeof fingerprintAnswersFromAttempt>[0]);
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

  // IMPORTANT: preserve the backend-provided order. The bundle delivers
  // questions in the per-attempt sequence (att.question_order), which is the
  // same order the post-submission review uses. Re-sorting here by `order`/`id`
  // (via normalizeQuestionList) silently diverges the runner's numbering from
  // the review's, so e.g. the runner's "Question 3" shows up elsewhere in review.
  const ordered = useMemo(
    () => (Array.isArray(questions) ? questions : []),
    [questions],
  );
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

  // ── Mandatory full screen ───────────────────────────────────────────────────
  // Assessments run in full screen like a proctored exam. We don't auto-submit
  // on exit (the timer is informational) — instead a blocking overlay forces the
  // student back into full screen. The overlay's button is also the user gesture
  // that enters full screen on first load (browsers require a gesture).
  const {
    isFullscreen: fsIsFullscreen,
    enter: fsEnter,
    exit: fsExit,
    supported: fsSupported,
  } = useFullscreen();
  const [showFsWarning, setShowFsWarning] = useState(false);

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

  // ── Per-question SAT tooling state ──────────────────────────────────────────
  // Eliminated answer choices (per question id → set of choice ids).
  const [eliminatedByQid, setEliminatedByQid] = useState<Record<number, Set<string>>>({});
  // Persistent highlighter mode (toggle in header). Highlights themselves are
  // managed by useAnnotator inside ExamSimulationView (offset-based; persisted in
  // localStorage by region, survive re-renders / refresh / navigation).
  const [highlighterActive, setHighlighterActive] = useState(false);

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

  // Enforce full screen only while actively taking the assessment — never in
  // passive (other-tab) mode, on terminal screens, or where the browser can't
  // do full screen (so unsupported browsers aren't locked out).
  const fsEnforced =
    stage === "exam" && !isPassive && fsSupported && Boolean(current);
  // Show the blocking overlay only after the student has stayed OUT of full
  // screen past a short grace window, so the native enter/exit transition never
  // flashes the modal. Hidden the instant they're back in full screen.
  useEffect(() => {
    if (!fsEnforced || fsIsFullscreen) {
      setShowFsWarning(false);
      return;
    }
    const t = setTimeout(() => setShowFsWarning(true), 400);
    return () => clearTimeout(t);
  }, [fsEnforced, fsIsFullscreen]);

  // Leave full screen on the way out (submit complete / unmount) so students
  // aren't stuck full screen on the results screen.
  useEffect(() => {
    if (stage === "complete" || stage === "version-conflict") void fsExit();
  }, [stage, fsExit]);

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
      // version-conflict is terminal — the attempt can't be submitted, so don't
      // trap the student with an "unsaved work" prompt on their way to restart.
      if (stage === "complete" || stage === "submitting" || stage === "version-conflict") return;
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
      const submitResponse = await submit.mutateAsync({
        attempt_id: attemptId,
        question_times: { ...questionTimesRef.current },
      });
      // Use server-authoritative submitted_at so the receipt timestamp matches
      // what the server recorded, even if the client clock drifted.
      const serverSubmittedAt = submitResponse?.attempt?.submitted_at
        ? new Date(submitResponse.attempt.submitted_at).getTime()
        : null;
      clearAttemptDraftStorage(attemptId);
      clearDraftMirror(attemptId);
      writeSubmitReceipt(attemptId, assignmentId ?? null, serverSubmittedAt);
      // Notify parent page (backward compat for any listeners)
      window.dispatchEvent(
        new CustomEvent("assessment:submitted", { detail: { attemptId } }),
      );
      // Skip the post-submit time-summary screen — go straight to the results
      // page. A full navigation also drops the runner's full-screen takeover.
      window.location.assign(assignmentId ? `/assessments/result/${assignmentId}` : "/classes");
      // submitInflightRef intentionally stays true — successful submit should
      // never be re-fired even if the user navigates back to this surface.
    } catch (e) {
      const ax = normalizeApiError(e);
      // 409 = the assessment's questions were changed by the teacher while this
      // attempt was open, so its snapshot no longer matches. This is TERMINAL:
      // the attempt can't be submitted and must be restarted. Do NOT drop back to
      // the confirm-submit retry loop (that caused students to hammer submit) —
      // keep the inflight guard set and show a dedicated conflict screen.
      if (ax.status === 409) {
        setStage("version-conflict");
        return;
      }
      submitInflightRef.current = false; // allow student to retry
      setStage("confirm-submit");
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
          {questionFigureUrl(current) && (
            <img
              src={questionFigureUrl(current)}
              alt="Question figure"
              className="mb-4 max-h-[360px] max-w-full rounded-xl border border-border object-contain"
            />
          )}
          <MathText
            text={String(current?.prompt || "").trim() || "—"}
            block
            className="text-base font-semibold text-foreground leading-relaxed"
          />
          {/* Question instruction / stimulus — between the stem and the options */}
          {Boolean(current?.question_prompt) && (
            <div className="mt-4 border-l-4 border-primary/40 pl-4 py-1 bg-surface-2/50 rounded-r-xl">
              <MathText
                text={String(current!.question_prompt)}
                block
                className="text-sm text-foreground leading-relaxed font-[Georgia,serif] italic"
              />
            </div>
          )}
          <div className="mt-5 pointer-events-none select-none opacity-75">
            <AnswerInput
              type={String(current?.question_type || "") as import("@/features/assessments/types").AssessmentQuestionType}
              choices={parseChoices(current?.choices)}
              value={_passiveAnswer}
              onChange={() => {/* read-only */}}
              optionImages={optionImagesFromQuestion(current)}
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

  // ── Stage: complete ─────────────────────────────────────────────────────────
  // ── Stage: version-conflict (terminal) ──────────────────────────────────────
  // The teacher edited this assessment's questions while the attempt was open, so
  // its snapshot no longer matches and it cannot be submitted. Guide the student
  // to restart instead of letting them hammer a submit button that always 409s.
  if (stage === "version-conflict") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-6">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-10 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle className="h-7 w-7 text-amber-600" />
          </div>
          <p className="text-lg font-extrabold text-foreground">This assessment was updated</p>
          <p className="text-sm text-muted-foreground">
            Your teacher changed the questions while you were working, so this attempt
            can’t be submitted. Please start it again from your assignments — your new
            attempt will use the latest version.
          </p>
          <button
            type="button"
            onClick={() => {
              void fsExit();
              window.location.assign(assignmentId ? `/assessments/${assignmentId}` : "/classes");
            }}
            className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Back to assignments
          </button>
        </div>
      </div>
    );
  }

  if (stage === "complete") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-6">
        <CompleteScreen
          title={setTitle}
          assignmentId={assignmentId ?? null}
          attemptId={attemptId}
        />
      </div>
    );
  }

  // ── Stage: submitting ───────────────────────────────────────────────────────
  if (stage === "submitting") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-6">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-12 text-center space-y-4">
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
      <div className="flex min-h-screen items-center justify-center px-4 py-6">
        <div className="w-full max-w-2xl space-y-4">
          <SubmitConfirmScreen
            title={setTitle}
            answeredCount={answeredCount}
            totalCount={totalCount}
            onConfirm={() => void handleSubmitConfirm()}
            onBack={() => setStage("exam")}
          />
          {submitError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {submitError}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Stage: exam — SAT/pastpaper-style full-screen simulation ─────────────
  const subjectLabel = (() => {
    const raw = set?.subject ? String(set.subject).trim() : "";
    if (!raw) return "Assessment";
    // Pretty-print common subjects (english → English, math → Math) but keep
    // any custom subject name untouched beyond title casing.
    const map: Record<string, string> = {
      english: "English",
      math: "Math",
      reading_writing: "Reading & Writing",
      "reading & writing": "Reading & Writing",
    };
    const key = raw.toLowerCase();
    if (map[key]) return map[key];
    return raw
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
      .join(" ");
  })();
  return (
    <>
    <ExamSimulationView
      // Header / meta
      setTitle={setTitle}
      subject={subjectLabel}
      classroomName={runnerMeta?.classroom_name ?? null}
      // Timer
      elapsedSec={elapsedSec}
      questionElapsedSec={
        (questionTimesRef.current[currentQuestionId] || 0) +
        Math.floor((Date.now() - currentQuestionStartRef.current) / 1000)
      }
      // Connectivity / save state
      online={online}
      saveState={saveState}
      saveError={saveError}
      onRetrySave={() => void flushSave()}
      draftRestoredBanner={draftRestoredBanner}
      justReconnected={justReconnected}
      // Conflicts
      conflicts={conflicts}
      onResolveKeepMine={resolveKeepMine}
      onResolveUseOther={resolveUseOther}
      onResolveKeepAllMine={resolveKeepAllMine}
      conflictSaving={save.isPending}
      // Question state
      currentIdx={currentIdx}
      totalCount={totalCount}
      answeredCount={answeredCount}
      answeredIds={answeredIds}
      questionIds={questionIds}
      onJump={setCurrentIdx}
      current={current}
      answerValue={answerValue}
      onAnswer={(next) => {
        setDraftById((prev) => ({ ...prev, [currentQuestionId]: next }));
        enqueueSave(currentQuestionId, next);
      }}
      // Per-question SAT tools
      eliminatedChoices={eliminatedByQid[currentQuestionId] ?? new Set<string>()}
      onToggleElim={(choiceId) => {
        setEliminatedByQid((prev) => {
          const cur = new Set(prev[currentQuestionId] ?? []);
          if (cur.has(choiceId)) cur.delete(choiceId);
          else cur.add(choiceId);
          return { ...prev, [currentQuestionId]: cur };
        });
      }}
      highlighterActive={highlighterActive}
      onToggleHighlighter={() => setHighlighterActive((v) => !v)}
      attemptId={attemptId}
      questionId={currentQuestionId}
      // Navigation
      onPrevious={() => setCurrentIdx((i) => Math.max(0, i - 1))}
      onNext={() => setCurrentIdx((i) => Math.min(totalCount - 1, i + 1))}
      onSubmitClick={() => {
        if (conflicts.length) {
          setSubmitError("Please resolve the answer conflict above before submitting.");
          return;
        }
        setStage("confirm-submit");
      }}
    />
    {showFsWarning && (
      <FullscreenWarning onReturn={() => void fsEnter()} />
    )}
    </>
  );
}

// ─── ExamSimulationView ───────────────────────────────────────────────────────
// SAT-pastpaper-style full-screen simulation surface. Mirrors the visual
// language of /exam/[attemptId] (white background, top header with timer,
// clean question card, bottom nav bar) but specialised for assessment runs:
// count-up timer (no deadline), single-column question layout, no calculator/
// highlighter (assessment questions are simpler than SAT modules).

type ExamSimulationProps = {
  setTitle: string;
  subject: string;
  classroomName: string | null;

  elapsedSec: number;
  questionElapsedSec: number;

  online: boolean;
  saveState: SaveState;
  saveError: string | null;
  onRetrySave: () => void;
  draftRestoredBanner: boolean;
  justReconnected: boolean;

  conflicts: AnswerConflict[];
  onResolveKeepMine: (qid: number) => Promise<void>;
  onResolveUseOther: (qid: number) => void;
  onResolveKeepAllMine: () => void;
  conflictSaving: boolean;

  currentIdx: number;
  totalCount: number;
  answeredCount: number;
  answeredIds: Set<number>;
  questionIds: number[];
  onJump: (idx: number) => void;
  current: Record<string, unknown> | undefined;
  answerValue: unknown;
  onAnswer: (next: unknown) => void;

  // SAT tools
  eliminatedChoices: Set<string>;
  onToggleElim: (choiceId: string) => void;
  highlighterActive: boolean;
  onToggleHighlighter: () => void;
  /** Identifies the annotation offset-store namespace (region highlights). */
  attemptId: number;
  questionId: number;

  onPrevious: () => void;
  onNext: () => void;
  onSubmitClick: () => void;
};

function ExamSimulationView({
  setTitle,
  subject,
  classroomName,
  elapsedSec,
  questionElapsedSec,
  online,
  saveState,
  saveError,
  onRetrySave,
  draftRestoredBanner,
  justReconnected,
  conflicts,
  onResolveKeepMine,
  onResolveUseOther,
  onResolveKeepAllMine,
  conflictSaving,
  currentIdx,
  totalCount,
  answeredCount,
  answeredIds,
  questionIds,
  onJump,
  current,
  answerValue,
  onAnswer,
  eliminatedChoices,
  onToggleElim,
  highlighterActive,
  onToggleHighlighter,
  attemptId,
  questionId,
  onPrevious,
  onNext,
  onSubmitClick,
}: ExamSimulationProps) {
  const [showTimer, setShowTimer] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const zoomIn = () => setZoomLevel((z) => Math.min(1.5, +(z + 0.1).toFixed(2)));
  const zoomOut = () => setZoomLevel((z) => Math.max(0.7, +(z - 0.1).toFixed(2)));

  const isLast = currentIdx >= totalCount - 1;

  // ── Offset-based highlighter (reuses the pastpaper/exam annotator) ────────
  // Stores highlights as character offsets per region and repaints the <mark>
  // spans via useLayoutEffect after every commit, so they survive re-renders
  // (the 1-second timer), math, navigation and refresh. The attemptId is
  // namespaced with "asmt-" so assessment highlights never collide with exam
  // attempts in the shared `ts.annot.*` localStorage.
  const annotator = useAnnotator({
    attemptId: `asmt-${attemptId}`,
    questionId: questionId || undefined,
    active: highlighterActive,
    getContainers: () => [
      { key: "passage", el: document.getElementById("assessment-passage-content") },
      { key: "question", el: document.getElementById("assessment-question-content") },
      { key: "choices", el: document.getElementById("assessment-choices") },
    ],
  });

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col font-sans text-slate-900 overflow-hidden">
      {/* Top banners — render above the header without breaking its layout */}
      {!online && (
        <div className="w-full bg-amber-50 border-b border-amber-200 text-amber-900 text-xs font-bold py-1.5 px-4 text-center">
          Offline. Your answers are kept locally and will sync when you reconnect.
        </div>
      )}
      {draftRestoredBanner && online && (
        <div className="w-full bg-sky-50 border-b border-sky-200 text-sky-800 text-xs font-bold py-1.5 px-4 text-center">
          Your answers from your last session have been restored.
        </div>
      )}
      {online && justReconnected && (
        <div className="w-full bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs font-bold py-1.5 px-4 text-center">
          Reconnected — syncing your answers now.
        </div>
      )}
      {saveState === "error" && saveError && (
        <div className="w-full bg-amber-50 border-b border-amber-200 px-4 py-1.5 flex items-center justify-center gap-3">
          <p className="text-xs font-bold text-amber-800">{saveError}</p>
          <button
            type="button"
            onClick={onRetrySave}
            className="text-xs font-bold text-amber-700 hover:underline whitespace-nowrap"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Header (logo · title — timer — zoom / counters) ─────────────────── */}
      <header className="flex items-start justify-between px-6 py-3 bg-white border-b border-slate-100 shadow-sm shrink-0">
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <img src="/images/logo.png" alt="Master SAT" className="w-8 h-8 object-contain" />
          <div className="min-w-0">
            {classroomName && (
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] truncate">
                {classroomName}
              </p>
            )}
            <h1 className="text-sm font-bold text-slate-900 tracking-tight truncate">
              {subject}: {setTitle}
            </h1>
          </div>
        </div>

        {/* Timer (count-up) */}
        <div className="flex-1 flex flex-col items-center">
          {showTimer ? (
            <>
              <span className="text-lg font-bold font-mono tracking-tight tabular-nums">
                {fmtElapsed(elapsedSec)}
              </span>
              <button
                onClick={() => setShowTimer(false)}
                className="mt-0.5 text-[10px] font-bold text-slate-600 border border-slate-300 rounded-full px-3 py-0.5 hover:bg-slate-50 transition-colors"
              >
                Hide
              </button>
            </>
          ) : (
            <>
              <Timer className="w-5 h-5 text-slate-400" />
              <button
                onClick={() => setShowTimer(true)}
                className="mt-0.5 text-[10px] font-bold text-slate-600 border border-slate-300 rounded-full px-3 py-0.5 hover:bg-slate-50 transition-colors"
              >
                Show
              </button>
            </>
          )}
        </div>

        {/* Right controls: zoom + counters + connectivity + save dot */}
        <div className="flex-1 flex justify-end items-start gap-4 pt-1">
          <button
            onClick={zoomOut}
            disabled={zoomLevel <= 0.7}
            className={`flex flex-col items-center gap-0.5 transition-all ${zoomLevel <= 0.7 ? "text-slate-300" : "text-slate-600 hover:text-slate-900"}`}
          >
            <span className="w-5 h-5 flex items-center justify-center border-2 border-current rounded font-bold text-xs">-</span>
            <span className="text-[9px] font-bold uppercase tracking-wider">Zoom Out</span>
          </button>
          <span className="text-[10px] font-bold text-slate-400 mt-1.5">{Math.round(zoomLevel * 100)}%</span>
          <button
            onClick={zoomIn}
            disabled={zoomLevel >= 1.5}
            className={`flex flex-col items-center gap-0.5 transition-all ${zoomLevel >= 1.5 ? "text-slate-300" : "text-slate-600 hover:text-slate-900"}`}
          >
            <span className="w-5 h-5 flex items-center justify-center border-2 border-current rounded font-bold text-xs">+</span>
            <span className="text-[9px] font-bold uppercase tracking-wider">Zoom In</span>
          </button>
          <button
            onClick={onToggleHighlighter}
            title={highlighterActive ? "Disable highlighter" : "Enable highlighter"}
            className={`flex flex-col items-center gap-0.5 transition-colors ${
              highlighterActive ? "text-yellow-600" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Highlighter className="w-5 h-5" />
            <span className="text-[9px] font-bold uppercase tracking-wider">
              {highlighterActive ? "On" : "Highlight"}
            </span>
          </button>
          <div className="w-px h-8 bg-slate-100" />
          <div className="flex flex-col items-center pt-0.5 gap-0.5">
            <span className="text-sm font-bold text-slate-700 tabular-nums">{answeredCount}/{totalCount}</span>
            <div className="flex items-center gap-1.5">
              {online ? <Wifi className="h-3 w-3 text-slate-400" /> : <WifiOff className="h-3 w-3 text-amber-500" />}
              <SaveDot state={saveState} />
            </div>
          </div>
        </div>
      </header>

      {/* ── Conflict resolution banner (inline so it never blocks layout) ──── */}
      {conflicts.length > 0 && (
        <div className="px-6 py-2 border-b border-amber-200 bg-amber-50">
          <ConflictDialog
            conflicts={conflicts}
            onKeepMine={onResolveKeepMine}
            onUseOther={onResolveUseOther}
            onKeepAllMine={onResolveKeepAllMine}
            saving={conflictSaving}
          />
        </div>
      )}

      {/* ── Question area ───────────────────────────────────────────────────────
          min-h-0 is REQUIRED: without it a flex child's min-height defaults to
          its content height, so a tall question+answers column grows past the
          viewport and pushes the fixed footer out of the overflow-hidden overlay
          (the footer "disappears"). With min-h-0 the column scrolls internally and
          the header/footer stay pinned. */}
      <main className="flex-1 min-h-0 overflow-y-auto bg-white">
        <div
          className={`mx-auto w-full max-w-3xl px-8 py-10 ${highlighterActive ? "ms-highlighter-cursor" : ""}`}
          style={{ fontSize: `${zoomLevel}rem` }}
        >
          {/* Question header line (question N of M + per-question time) */}
          <div className="flex items-center justify-between mb-6 pb-3 border-b border-slate-200">
            <p className="text-xs font-extrabold text-slate-700 uppercase tracking-widest">
              Question {currentIdx + 1} of {totalCount}
            </p>
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              <span className="tabular-nums">{fmtElapsed(questionElapsedSec)}</span>
            </div>
          </div>

          {/* Question figure (diagram/chart) — ABOVE the question stem */}
          {questionFigureUrl(current) && (
            <img
              src={questionFigureUrl(current)}
              alt="Question figure"
              className="mb-5 max-h-[420px] max-w-full rounded-xl border border-slate-200 object-contain"
            />
          )}

          {/* The question itself */}
          <StableHtml
            id="assessment-question-content"
            className={`text-lg font-normal text-slate-900 leading-relaxed font-[Georgia,serif] ${highlighterActive ? "cursor-text" : ""}`}
            html={processInstructionalText(String(current?.prompt || "").trim() || "—")}
          />

          {/* Question instruction / stimulus — sits BETWEEN the stem and the
              options (e.g. "Which choice completes the text…"). The id lives on
              the stable content div so the annotator can repaint its marks. */}
          {Boolean(current?.question_prompt) && (
            <StableHtml
              id="assessment-passage-content"
              className={`mt-6 border-l-4 border-slate-300 pl-5 py-1 text-base text-slate-700 leading-relaxed font-[Georgia,serif] ${highlighterActive ? "cursor-text" : ""}`}
              html={processInstructionalText(String(current!.question_prompt))}
            />
          )}

          {/* Answer input — single annotatable region for all choices */}
          <div id="assessment-choices" className="mt-8">
            <AnswerInput
              type={String(current?.question_type || "") as import("@/features/assessments/types").AssessmentQuestionType}
              choices={parseChoices(current?.choices)}
              value={answerValue}
              onChange={onAnswer}
              eliminated={eliminatedChoices}
              onToggleElim={onToggleElim}
              highlighterActive={highlighterActive}
              optionImages={optionImagesFromQuestion(current)}
            />
          </div>
        </div>
      </main>

      {/* ── Annotation toolbar (recolour / underline / delete) ─────────────── */}
      {annotator.toolbar && (
        <AnnotationToolbar
          toolbar={annotator.toolbar}
          onColor={annotator.applyColor}
          onUnderline={annotator.applyUnderline}
          onDelete={annotator.deleteAnnotation}
          onClose={annotator.dismiss}
        />
      )}

      {/* ── Question map drawer (toggled from bottom bar) ───────────────────── */}
      {showMap && (
        <div
          className="absolute inset-0 z-40 bg-black/40"
          onClick={() => setShowMap(false)}
        >
          <div
            className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 max-w-2xl w-[calc(100%-2rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-extrabold text-slate-700 uppercase tracking-widest">
                Question navigation
              </p>
              <button
                onClick={() => setShowMap(false)}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <QuestionMap
              total={totalCount}
              currentIdx={currentIdx}
              answeredIds={answeredIds}
              questionIds={questionIds}
              onJump={(i) => {
                onJump(i);
                setShowMap(false);
              }}
            />
            <div className="mt-4 flex items-center gap-4 text-[11px] font-bold text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-primary inline-block" /> Current
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-emerald-100 border border-emerald-300 inline-block" /> Answered
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-slate-100 border border-slate-300 inline-block" /> Unanswered
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom nav bar (previous · question map · next/submit) ─────────── */}
      <footer className="bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
        <button
          type="button"
          onClick={onPrevious}
          disabled={currentIdx === 0}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>

        <button
          type="button"
          onClick={() => setShowMap((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-slate-800 transition-colors"
        >
          <span className="tabular-nums">Question {currentIdx + 1} of {totalCount}</span>
          <ChevronUp className={`h-4 w-4 transition-transform ${showMap ? "rotate-180" : ""}`} />
        </button>

        {isLast ? (
          <button
            type="button"
            onClick={onSubmitClick}
            disabled={conflicts.length > 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Send className="h-4 w-4" />
            Review &amp; Submit
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </footer>
    </div>
  );
}
