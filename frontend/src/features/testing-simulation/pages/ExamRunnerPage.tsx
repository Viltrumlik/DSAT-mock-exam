"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { useMe } from "@/hooks/useMe";

import { useExamAttempt } from "../hooks/useExamAttempt";
import { useAnswers } from "../hooks/useAnswers";
import { useModuleTimer } from "../hooks/useModuleTimer";
import { useModuleSubmit } from "../hooks/useModuleSubmit";
import { useAutosave } from "../hooks/useAutosave";
import { useMathRendering } from "../hooks/useMathRendering";

import { examApi } from "../services/examApiClient";
import { isCompleted, isModulePayloadMissing, isScoring } from "../state/attemptMerge";
import { isMath, moduleLabel, pauseAllowed, questions as selectQuestions, subjectKind } from "../state/selectors";
import { FIVE_MINUTE_WARNING_SECONDS } from "../utils/time";
import { clamp } from "../utils/time";
import { parseOptions } from "../utils/options";

import { ExamHeader } from "../components/ExamHeader";
import { PassagePane } from "../components/PassagePane";
import { AnswerPane } from "../components/AnswerPane";
import { ExamFooter } from "../components/ExamFooter";
import { QuestionNavigator } from "../components/QuestionNavigator";
import { ModuleTransitionOverlay } from "../components/ModuleTransitionOverlay";
import { ErrorScreen, LoadingScreen, ScoringScreen } from "../components/StatusScreens";

import { useExamTools, ExamToolsLayer, MultiTabOverlay, useKeyboardShortcuts } from "../tools";
import { useMultiTabGuard } from "../tools/useMultiTabGuard";

/** Reflects browser connectivity so the runner can surface an offline state. */
function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/**
 * Top-level Testing Simulation runner. Pure composition: it owns no engine
 * logic itself — it wires the attempt, timer, answers, submit and autosave
 * hooks together and lays out the SAT-style UI.
 */
export function ExamRunnerPage() {
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();
  const attemptId = Number(params.attemptId);
  const mockFlow = search.get("mockFlow") === "1";

  const { assertCriticalAuth } = useAuthCriticalGate();
  // Load-error recovery actions are admin-only; students never see a Retry button.
  const { me } = useMe();
  const role = String((me as { role?: string } | undefined)?.role ?? "").toLowerCase();
  const isAdmin = role !== "" && role !== "student";

  // Multi-tab guard is resolved BEFORE the engine hooks so a blocked duplicate
  // tab can actually suspend polling/autosave/timer (not just show an overlay).
  const multiTab = useMultiTabGuard(attemptId);
  const online = useOnlineStatus();

  const { attempt, loading, error, clock, applyAttempt, reload } = useExamAttempt({
    attemptId,
    assertCriticalAuth,
    pollingEnabled: !multiTab.blocked,
  });

  const { answers, flagged, eliminated, currentIndex, moduleId, selectAnswer, toggleFlag, toggleEliminate, goTo, next, prev } =
    useAnswers(attempt, attemptId);

  const liveQuestions = useMemo(() => selectQuestions(attempt), [attempt]);
  const currentQuestion = liveQuestions[currentIndex];

  // ── SAT-experience tools (isolated from the engine) ─────────────────────────
  const tools = useExamTools({
    attemptId,
    questionId: currentQuestion?.id,
    getPassageContainer: () => document.getElementById("ts-passage"),
  });

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [paused, setPaused] = useState(false);
  const [eliminationMode, setEliminationMode] = useState(false);
  const [timerHidden, setTimerHidden] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [showDirections, setShowDirections] = useState(false);
  const [splitPct, setSplitPct] = useState(50);
  const [transitionTo, setTransitionTo] = useState<number | null>(null);
  const zoom = tools.zoom;

  // Keyboard shortcuts (pure input → existing handlers; no engine coupling).
  useKeyboardShortcuts({
    enabled: !loading && Boolean(currentQuestion) && transitionTo === null && !multiTab.blocked,
    onPrev: prev,
    onNext: next,
    onToggleMark: () => currentQuestion && toggleFlag(currentQuestion.id),
    onToggleNavigator: () => setNavigatorOpen((v) => !v),
    onToggleHelp: tools.toggleHelp,
    onSelectChoice: (idx) => {
      if (!currentQuestion || currentQuestion.is_math_input) return;
      const key = parseOptions(currentQuestion)[idx]?.key;
      if (key) selectAnswer(currentQuestion.id, key);
    },
  });

  // ── Submit (manual + auto on expiry) ────────────────────────────────────────
  const { submit, submitting, submitError, clearSubmitError } = useModuleSubmit({
    attemptId,
    attempt,
    answers,
    flagged,
    applyAttempt,
    assertCriticalAuth,
  });

  const onExpire = useCallback(() => {
    void submit();
  }, [submit]);

  const { secondsLeft, ready: timerReady } = useModuleTimer({
    attempt,
    clock,
    // A blocked duplicate tab must not run the countdown or auto-submit.
    paused: (paused && pauseAllowed(attempt, mockFlow)) || multiTab.blocked,
    onExpire,
  });

  // Autosave only while genuinely interactive (not submitting / transitioning /
  // paused, and never from a blocked duplicate tab).
  const saveState = useAutosave({
    attempt,
    attemptId,
    answers,
    flagged,
    answersModuleId: moduleId,
    applyAttempt,
    enabled: !submitting && transitionTo === null && !(paused && pauseAllowed(attempt, mockFlow)) && !multiTab.blocked,
    online,
  });

  const mathQuestions = isMath(attempt);
  useMathRendering(!loading && Boolean(attempt?.current_module_details), `${moduleId}:${currentIndex}`);

  // ── Timer warnings: 5 min, 1 min, expiry (per module; read-only on the clock) ─
  const [timerToast, setTimerToast] = useState<string | null>(null);
  const firedRef = useRef<{ moduleId: number | null; fired: Set<number> }>({ moduleId: null, fired: new Set() });
  useEffect(() => {
    if (!timerReady || moduleId == null) return;
    const f = firedRef.current;
    if (f.moduleId !== moduleId) {
      f.moduleId = moduleId;
      f.fired = new Set();
    }
    const fire = (at: number, msg: string) => {
      if (!f.fired.has(at)) {
        f.fired.add(at);
        setTimerToast(msg);
      }
    };
    if (secondsLeft <= 0) fire(0, "Time's up — submitting this module…");
    else if (secondsLeft <= 60) fire(60, "1 minute remaining in this module.");
    else if (secondsLeft <= 300) fire(300, "5 minutes remaining in this module.");
  }, [secondsLeft, timerReady, moduleId]);
  useEffect(() => {
    if (!timerToast) return;
    const t = setTimeout(() => setTimerToast(null), 8000);
    return () => clearTimeout(t);
  }, [timerToast]);

  // ── Autosave / connectivity status label (P0 visibility) ─────────────────────
  // Every label reflects the autosave hook's *actual* state — "Reconnecting…"
  // means a retry is genuinely in flight, "Save failed" only after retries are
  // exhausted, and the local draft always backs the work in either case.
  const saveLabel =
    !online || saveState.status === "offline"
      ? "Offline — saved on this device"
      : saveState.status === "saving"
        ? "Saving…"
        : saveState.status === "retrying"
          ? "Reconnecting…"
          : saveState.status === "error"
            ? "Save failed — saved on this device"
            : saveState.status === "saved"
              ? "Saved"
              : "";
  const saveTone: "muted" | "warn" | "ok" =
    !online || saveState.status === "offline" || saveState.status === "error" || saveState.status === "retrying"
      ? "warn"
      : saveState.status === "saved"
        ? "ok"
        : "muted";

  // ── Sync pause state from server, once per attempt load (mocks never pause) ───
  const syncedPauseRef = useRef<number | null>(null);
  useEffect(() => {
    if (!attempt) return;
    if (!pauseAllowed(attempt, mockFlow)) {
      setPaused(false);
      return;
    }
    if (syncedPauseRef.current === attempt.id) return;
    syncedPauseRef.current = attempt.id;
    setPaused(Boolean(attempt.is_paused));
  }, [attempt, mockFlow]);

  // ── Module transition overlay: show briefly when the module order increases ──
  const prevOrderRef = useRef(0);
  useEffect(() => {
    const order = attempt?.current_module_details?.module_order ?? 0;
    if (prevOrderRef.current > 0 && order > prevOrderRef.current) {
      const to = order;
      setTransitionTo(to);
      const t = setTimeout(() => setTransitionTo(null), 1800);
      prevOrderRef.current = order;
      return () => clearTimeout(t);
    }
    if (order > 0) prevOrderRef.current = order;
  }, [attempt?.current_module_details?.module_order]);

  // ── Route out on completion (respecting mock flow) ──────────────────────────
  useEffect(() => {
    if (!attempt || !isCompleted(attempt)) return;
    const meid = search.get("mockExamId");
    const kind = subjectKind(attempt);
    if (mockFlow && meid && kind === "READING_WRITING") {
      router.push(`/mock/${meid}/break?rwAttempt=${attemptId}`);
      return;
    }
    if (mockFlow && meid && kind === "MATH") {
      const rw = search.get("rwAttempt");
      const qs = rw ? `?rwAttempt=${encodeURIComponent(rw)}&mathAttempt=${attemptId}` : `?mathAttempt=${attemptId}`;
      router.push(`/mock/${meid}/results${qs}`);
      return;
    }
    router.push(`/review/${attemptId}`);
  }, [attempt, mockFlow, search, router, attemptId]);

  // ── Resizable split divider ─────────────────────────────────────────────────
  const mainRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const onDividerDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!draggingRef.current || !mainRef.current) return;
      const rect = mainRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      setSplitPct(clamp(((e.clientX - rect.left) / rect.width) * 100, 28, 72));
    };
    const up = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const handlePauseToggle = useCallback(async () => {
    if (!attempt || !pauseAllowed(attempt, mockFlow)) return;
    const nextPaused = !paused;
    setPaused(nextPaused); // optimistic
    try {
      const snap = nextPaused ? await examApi.pause(attemptId) : await examApi.resumePause(attemptId);
      applyAttempt(snap);
    } catch {
      setPaused(!nextPaused); // revert on failure
    }
  }, [attempt, mockFlow, paused, attemptId, applyAttempt]);

  // ── Save & Exit ─────────────────────────────────────────────────────────────
  // Force-majeure stop: persist current work (and pause the clock where allowed),
  // then leave. Returning to /exam/[id] resumes exactly where the student left
  // off. Uses the existing save/pause services — the engine itself is untouched.
  const [exiting, setExiting] = useState(false);
  const handleSaveAndExit = useCallback(async () => {
    setExiting(true);
    try {
      if (attempt && pauseAllowed(attempt, mockFlow)) {
        try {
          applyAttempt(await examApi.pause(attemptId));
        } catch {
          /* best-effort pause */
        }
      }
      applyAttempt(await examApi.saveAttempt(attemptId, answers, flagged, { expectedVersionNumber: attempt?.version_number }));
    } catch {
      /* progress is also continuously autosaved; proceed to exit regardless */
    } finally {
      router.push("/");
    }
  }, [attempt, mockFlow, attemptId, answers, flagged, applyAttempt, router]);

  // ── Render gates ────────────────────────────────────────────────────────────
  const questions = liveQuestions;
  const twoPane = !mathQuestions; // RW shows passage + answers; Math is single column

  // A duplicate tab must not run a second timer/poller for the same attempt.
  // (Engine hooks above are already suspended via pollingEnabled / paused / enabled.)
  if (multiTab.blocked) {
    return <MultiTabOverlay onContinue={multiTab.takeOver} />;
  }

  if (exiting) {
    return <LoadingScreen label="Saving your progress…" />;
  }

  if (error) {
    return (
      <ErrorScreen
        title="Could not open the exam"
        message={error}
        {...(isAdmin ? { actionLabel: "Retry", onAction: reload } : { hint: "Please contact your teacher or administrator if this continues." })}
      />
    );
  }
  if (transitionTo !== null) {
    return <ModuleTransitionOverlay toModuleOrder={transitionTo} subjectLabel={moduleLabel(attempt)} />;
  }
  if (isScoring(attempt)) {
    return <ScoringScreen notice={null} />;
  }
  if (loading || !attempt || !attempt.current_module_details || !currentQuestion) {
    if (isModulePayloadMissing(attempt)) {
      return (
        <ErrorScreen
          title="Module failed to load"
          message="The attempt loaded but its module payload is missing. This is usually a transient server/network issue."
          {...(isAdmin ? { actionLabel: "Force refresh", onAction: reload } : { hint: "Please contact your teacher or administrator if this continues." })}
        />
      );
    }
    return <LoadingScreen />;
  }

  const warning = timerReady && secondsLeft <= FIVE_MINUTE_WARNING_SECONDS && secondsLeft > 0;

  return (
    <div className="flex h-screen flex-col bg-white">
      <ExamHeader
        moduleTitle={moduleLabel(attempt)}
        secondsLeft={secondsLeft}
        timerHidden={timerHidden}
        onToggleTimer={() => setTimerHidden((v) => !v)}
        timerWarning={warning}
        showDirections={showDirections}
        onToggleDirections={() => setShowDirections((v) => !v)}
        mathTools={mathQuestions}
        tools={tools}
        pauseAllowed={pauseAllowed(attempt, mockFlow)}
        paused={paused}
        onTogglePause={handlePauseToggle}
        onSaveAndExit={handleSaveAndExit}
      />

      <main
        ref={mainRef}
        className={`flex min-h-0 flex-1 overflow-hidden ${tools.highlighterActive ? "[&_#ts-passage]:cursor-text" : ""}`}
      >
        {twoPane ? (
          <>
            <PassagePane question={currentQuestion} zoom={zoom} style={{ width: `${splitPct}%`, flex: "none" }} />
            <div
              onMouseDown={onDividerDown}
              className="w-1 shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-blue-400"
              role="separator"
              aria-orientation="vertical"
            />
            <AnswerPane
              question={currentQuestion}
              displayNumber={currentIndex + 1}
              zoom={zoom}
              isMath={mathQuestions}
              flagged={flagged.includes(currentQuestion.id)}
              onToggleFlag={() => toggleFlag(currentQuestion.id)}
              eliminationMode={eliminationMode}
              onToggleEliminationMode={() => setEliminationMode((v) => !v)}
              answer={answers[currentQuestion.id]}
              eliminated={eliminated[currentQuestion.id] ?? []}
              onSelect={(v) => selectAnswer(currentQuestion.id, v)}
              onEliminate={(k) => toggleEliminate(currentQuestion.id, k)}
              style={{ width: `${100 - splitPct}%`, flex: "none" }}
            />
          </>
        ) : (
          <AnswerPane
            question={currentQuestion}
            displayNumber={currentIndex + 1}
            zoom={zoom}
            isMath={mathQuestions}
            flagged={flagged.includes(currentQuestion.id)}
            onToggleFlag={() => toggleFlag(currentQuestion.id)}
            eliminationMode={eliminationMode}
            onToggleEliminationMode={() => setEliminationMode((v) => !v)}
            answer={answers[currentQuestion.id]}
            eliminated={eliminated[currentQuestion.id] ?? []}
            onSelect={(v) => selectAnswer(currentQuestion.id, v)}
            onEliminate={(k) => toggleEliminate(currentQuestion.id, k)}
            style={{ width: "100%", flex: "none" }}
          />
        )}
      </main>

      <ExamFooter
        navLabel={`Question ${currentIndex + 1} of ${questions.length}`}
        onToggleNavigator={() => setNavigatorOpen((v) => !v)}
        canGoBack={currentIndex > 0}
        onBack={prev}
        isLastQuestion={currentIndex === questions.length - 1}
        onNext={next}
        onSubmitModule={() => void submit()}
        submitting={submitting}
        saveLabel={saveLabel}
        saveTone={saveTone}
      />

      <QuestionNavigator
        open={navigatorOpen}
        onClose={() => setNavigatorOpen(false)}
        title={moduleLabel(attempt)}
        questions={questions}
        currentIndex={currentIndex}
        answers={answers}
        flagged={flagged}
        onJump={goTo}
      />

      {/* All SAT-experience tool overlays (calculator, reference, notes, help,
          highlight popover). Single mount point; each is engine-isolated. */}
      <ExamToolsLayer tools={tools} attemptId={attemptId} />

      {/* Timer warnings (5 min / 1 min / expiry) — announced to screen readers. */}
      {timerToast && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed left-1/2 top-20 z-[65] -translate-x-1/2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-xl"
        >
          {timerToast}
        </div>
      )}

      {/* Recoverable submit failure — available to EVERY user, not just admins. */}
      {submitError && (
        <div role="alert" className="fixed inset-x-0 bottom-20 z-[65] flex justify-center px-4">
          <div className="flex max-w-md items-center gap-4 rounded-xl border border-red-200 bg-white px-5 py-3 shadow-xl">
            <span className="text-sm font-semibold text-slate-700">{submitError}</span>
            <button
              type="button"
              onClick={() => {
                clearSubmitError();
                void submit();
              }}
              disabled={submitting}
              className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Try again"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
