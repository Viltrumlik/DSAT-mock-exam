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

import { examApi, midtermExamApi, mockExamApi } from "../services/examApiClient";
import type { Attempt } from "../types";
import { mockApi } from "@/lib/mockApi";
import { isCompleted, isModulePayloadMissing, isScoring } from "../state/attemptMerge";
import {
  calculatorAllowed,
  isMath,
  isMidtermAttempt,
  moduleLabel,
  pauseAllowed,
  questions as selectQuestions,
  subjectKind,
} from "../state/selectors";
import { FIVE_MINUTE_WARNING_SECONDS } from "../utils/time";
import { clamp } from "../utils/time";
import { parseOptions } from "../utils/options";

import { ExamHeader } from "../components/ExamHeader";
import { ReportProblemModal } from "@/features/question-reports/ReportProblemModal";
import { SatColorRule } from "../components/SatColorRule";
import { PassagePane } from "../components/PassagePane";
import { AnswerPane } from "../components/AnswerPane";
import { DirectionsOverlay } from "../components/DirectionsOverlay";
import { ExamFooter } from "../components/ExamFooter";
import { QuestionNavigator } from "../components/QuestionNavigator";
import { ModuleTransitionOverlay } from "../components/ModuleTransitionOverlay";
import { ErrorScreen, LoadingScreen, ScoringScreen } from "../components/StatusScreens";
import { WelcomeScreen } from "../components/WelcomeScreen";
import { MidtermRulesScreen } from "../components/MidtermRulesScreen";
import { MidtermCodeScreen } from "../components/MidtermCodeScreen";
import { OffscreenTerminatedScreen, OffscreenWarning } from "../components/OffscreenWarning";
import { useOffscreenGuard } from "../hooks/useOffscreenGuard";
import { midtermApi } from "@/lib/midtermApi";
import { MockBreakScreen } from "../components/MockBreakScreen";
import { FullscreenWarning } from "../components/FullscreenWarning";
import { CheckYourWorkPage } from "../components/CheckYourWorkPage";
import { StudentProducedResponseGuide } from "../components/StudentProducedResponseGuide";
import { isStudentProducedResponse } from "../utils/questionKind";
import { ATTEMPT_STATE } from "../types";

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
  // Fresh pastpaper starts arrive with ?welcome=1 (set by the pastpaper card);
  // resumes don't, so they skip the welcome screen.
  const welcomeParam = search.get("welcome") === "1";
  // The separated midterm/mock reuse this runner (identical protocol) but talk to their own
  // backends. Selected by ?src=midterm (or legacy ?midterm=1) / ?src=mock.
  const isMidtermSrc = search.get("src") === "midterm" || search.get("midterm") === "1";
  const isMockSrc = search.get("src") === "mock";
  const engineApi = isMockSrc ? mockExamApi : isMidtermSrc ? midtermExamApi : examApi;

  const { assertCriticalAuth } = useAuthCriticalGate();
  // Load-error recovery actions are admin-only; students never see a Retry button.
  const { me } = useMe();
  const role = String((me as { role?: string } | undefined)?.role ?? "").toLowerCase();
  const isAdmin = role !== "" && role !== "student";
  // Student identity for the persistent footer (item: Student Identity Footer).
  const studentName = (() => {
    const u = me as { first_name?: string; last_name?: string } | undefined;
    return [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim();
  })();

  // Multi-tab guard is resolved BEFORE the engine hooks so a blocked duplicate
  // tab can actually suspend polling/autosave/timer (not just show an overlay).
  const multiTab = useMultiTabGuard(attemptId);
  const online = useOnlineStatus();

  const { attempt, loading, error, clock, applyAttempt, reload, start } = useExamAttempt({
    attemptId,
    assertCriticalAuth,
    pollingEnabled: !multiTab.blocked,
    // Pastpapers hold the timer until the student clicks Start on the Welcome
    // screen; mock-exam flow keeps its existing auto-start (it has its own
    // break/intro orchestration upstream).
    autoStart: mockFlow,
    api: engineApi,
  });

  const { answers, flagged, eliminated, currentIndex, moduleId, selectAnswer, toggleFlag, toggleEliminate, goTo, next, prev } =
    useAnswers(attempt, attemptId);

  const liveQuestions = useMemo(() => selectQuestions(attempt), [attempt]);
  const currentQuestion = liveQuestions[currentIndex];

  // THE midterm predicate. There used to be two — one from `?src=midterm` (which only says
  // which backend to talk to) and one from the attempt's own mock_kind — and gates keyed on
  // whichever was in scope, so the reference sheet appeared on a Math midterm reached
  // without the param. The param answers "before the attempt loads"; the attempt answers
  // "what this paper actually is"; every midterm rule below reads this one value.
  const isMidterm = isMidtermSrc || isMidtermAttempt(attempt);

  // ── SAT-experience tools (isolated from the engine) ─────────────────────────
  const tools = useExamTools({
    attemptId,
    questionId: currentQuestion?.id,
    // Highlightable regions — passage, question prompt/stem, and answer choices.
    // Each has its own offset space + storage, so annotations don't collide.
    getContainers: () => [
      { key: "passage", el: document.getElementById("ts-passage") },
      { key: "question", el: document.getElementById("ts-question") },
      { key: "choices", el: document.getElementById("ts-choices") },
    ],
  });

  // The live attempt + answers, readable at call time rather than from a render
  // closure. The autosave bumps version_number roughly once a second, so a
  // closure captured at render is routinely stale by the time an awaited handler
  // reaches its save — and save_attempt treats a version mismatch as a HARD 409
  // that discards the answers (unlike submit_module, which conflicts softly).
  const attemptRef = useRef<Attempt | null>(null);
  const answersRef = useRef<Record<string, string>>({});
  const flaggedRef = useRef<number[]>([]);

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [paused, setPaused] = useState(false);
  const [eliminationMode, setEliminationMode] = useState(false);
  const [timerHidden, setTimerHidden] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [showDirections, setShowDirections] = useState(false);
  // Welcome screen — shown once per fresh pastpaper start, acknowledged via the
  // Start button (persisted per attempt for the tab session so a refresh on the
  // running exam doesn't re-show it).
  const [welcomeAck, setWelcomeAck] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(`ts.welcomeAck.${attemptId}`) === "1";
    } catch {
      return false;
    }
  });
  const ackWelcome = useCallback(() => {
    setWelcomeAck(true);
    try {
      window.sessionStorage.setItem(`ts.welcomeAck.${attemptId}`, "1");
    } catch {
      /* sessionStorage unavailable — keep in-memory */
    }
  }, [attemptId]);
  // A midterm the server has already taken past NOT_STARTED is a RESUME: the student read
  // the rules and cleared the access code to get here (`start` 403s until the code is
  // verified), so sending them back through both is a bug — `welcomeAck` lives in
  // sessionStorage and is empty in a new tab or after a browser restart, while `?welcome=1`
  // is still sitting in the URL they resumed from.
  const midtermResumed =
    isMidterm && attempt != null && attempt.current_state !== ATTEMPT_STATE.NOT_STARTED;
  // Show the welcome/Start screen for a fresh pastpaper (?welcome=1) AND, as a
  // safety net, for ANY non-mock attempt the backend is still holding in
  // NOT_STARTED — so an entry path that dropped the welcome param can't strand
  // the student on a NOT_STARTED attempt (no module loaded, timer not begun).
  const showWelcome =
    !mockFlow &&
    !welcomeAck &&
    !midtermResumed &&
    (welcomeParam || attempt?.current_state === ATTEMPT_STATE.NOT_STARTED);
  // SPR directions panel collapse state — persisted for the tab session so it is
  // remembered while navigating between Student-Produced Response questions.
  const [sprGuideExpanded, setSprGuideExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const v = window.sessionStorage.getItem("ts.sprGuide.expanded");
      return v == null ? true : v === "1";
    } catch {
      return true;
    }
  });
  const toggleSprGuide = useCallback(() => {
    setSprGuideExpanded((v) => {
      const next = !v;
      try {
        window.sessionStorage.setItem("ts.sprGuide.expanded", next ? "1" : "0");
      } catch {
        /* sessionStorage unavailable — keep in-memory state */
      }
      return next;
    });
  }, []);
  const [splitPct, setSplitPct] = useState(50);
  const [transitionTo, setTransitionTo] = useState<number | null>(null);
  const zoom = tools.zoom;

  // Directions popover hangs from just below the header — measure its bottom on open
  // so it anchors correctly regardless of header height / zoom.
  const topChromeRef = useRef<HTMLDivElement>(null);
  const [dirTop, setDirTop] = useState(84);
  useEffect(() => {
    if (showDirections && topChromeRef.current) setDirTop(topChromeRef.current.getBoundingClientRect().bottom);
  }, [showDirections]);

  // ── Navigation freeze (item: Next / Back Freeze Protection) ──────────────────
  // After Next/Back, lock navigation for 500ms so a double-click (or held key)
  // can't skip a question or race the autosave/answer state. Visual feedback is
  // the disabled (dimmed) Back/Next buttons in the footer.
  const [navLocked, setNavLocked] = useState(false);
  const navLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (navLockTimer.current) clearTimeout(navLockTimer.current);
  }, []);
  const withNavLock = useCallback(
    (fn: () => void) => {
      if (navLocked) return;
      fn();
      setNavLocked(true);
      if (navLockTimer.current) clearTimeout(navLockTimer.current);
      navLockTimer.current = setTimeout(() => setNavLocked(false), 500);
    },
    [navLocked],
  );
  const guardedNext = useCallback(() => withNavLock(next), [withNavLock, next]);
  const guardedPrev = useCallback(() => withNavLock(prev), [withNavLock, prev]);

  // ── Welcome / start gate (items: Pastpaper Welcome Screen + Forced Fullscreen) ─
  // Start is the single user gesture that (a) enters fullscreen and (b) tells the
  // server to begin the module — so the timer genuinely doesn't run until now.
  const [starting, setStarting] = useState(false);
  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      if (tools.fullscreen.supported) {
        try {
          await tools.fullscreen.enter();
        } catch {
          /* user denied / unsupported — proceed without fullscreen */
        }
      }
      // Only call the engine start when the attempt genuinely hasn't begun
      // (forward-compatible with a future server-side timer hold). When the
      // backend already auto-started on create, Start just enters fullscreen.
      if (attempt?.current_state === ATTEMPT_STATE.NOT_STARTED) {
        await start();
      }
      ackWelcome();
    } finally {
      setStarting(false);
    }
  }, [tools.fullscreen, start, attempt?.current_state, ackWelcome]);

  // Midterm access-code gate (classroom flavor). The rules screen comes FIRST and the code
  // is asked for only after it, so we probe up front — an empty code succeeds only when no
  // code is required — and the rules screen can then tell the student whether they need one
  // instead of the Continue button discovering it mid-click. null = not answered yet.
  const [codeGateOpen, setCodeGateOpen] = useState(false);
  const [requiresCode, setRequiresCode] = useState<boolean | null>(null);
  const midtermAttemptId = attempt?.id;
  const midtermState = attempt?.current_state;
  useEffect(() => {
    if (!isMidterm || midtermAttemptId == null) return;
    if (midtermState !== ATTEMPT_STATE.NOT_STARTED) return; // a running attempt is past this
    if (requiresCode !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await midtermApi.verifyCode(midtermAttemptId, "");
        if (!cancelled) setRequiresCode(Boolean(r.requires_code));
      } catch {
        if (!cancelled) setRequiresCode(true); // rejected empty code = a code is required
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isMidterm, midtermAttemptId, midtermState, requiresCode]);
  // The server records the verification on the attempt, so a student who entered the code
  // and then lost the tab before `start` landed isn't asked for it twice.
  const midtermCodeVerified = Boolean(
    (attempt as { code_verified?: boolean; code_verified_at?: string | null } | null)?.code_verified ||
      (attempt as { code_verified_at?: string | null } | null)?.code_verified_at,
  );
  const handleMidtermProceed = useCallback(async () => {
    if (!attempt) return;
    if (midtermCodeVerified || requiresCode === false) {
      await handleStart();
      return;
    }
    if (requiresCode === true) {
      setCodeGateOpen(true);
      return;
    }
    try {
      await midtermApi.verifyCode(attempt.id, ""); // the probe hasn't landed yet — ask now
      await handleStart();
    } catch {
      setCodeGateOpen(true);
    }
  }, [attempt, handleStart, midtermCodeVerified, requiresCode]);
  const verifyThenStart = useCallback(
    async (code: string) => {
      if (!attempt) return;
      await midtermApi.verifyCode(attempt.id, code); // throws on an incorrect code
      await handleStart();
    },
    [attempt, handleStart],
  );

  // Close the Check Your Work page whenever the module changes (after a submit
  // advances M1→M2, or a fresh module loads) so it never lingers over new work.
  useEffect(() => {
    setReviewOpen(false);
  }, [attempt?.current_module_details?.id]);

  // ── Forced-fullscreen enforcement ────────────────────────────────────────────
  // Only enforce while the student is ACTIVELY in a pastpaper module — never on
  // the welcome/loading/scoring/transition/review screens, and never for mock
  // flow (which auto-starts with no Start gesture to establish fullscreen). This
  // prevents the countdown from ever firing where the student isn't actually
  // taking the test.
  const fsIsFull = tools.fullscreen.isFullscreen;
  const fsSupported = tools.fullscreen.supported;
  const fsEnforced =
    !mockFlow &&
    // Midterms are policed by the off-screen rule instead (below): leaving fullscreen is
    // one of the ways it detects a student leaving, and it has its own overlay, its own
    // countdown and a far harsher consequence. Running both would stack two modals over
    // each other and race two countdowns to two different endings.
    !isMidterm &&
    !showWelcome &&
    !multiTab.blocked &&
    transitionTo === null &&
    !reviewOpen &&
    !loading &&
    Boolean(currentQuestion) &&
    (attempt?.current_state === ATTEMPT_STATE.MODULE_1_ACTIVE ||
      attempt?.current_state === ATTEMPT_STATE.MODULE_2_ACTIVE);

  // Show the "return to fullscreen" overlay only after the student has stayed OUT
  // of fullscreen for a short grace window — so the native enter/exit transition
  // and the brief Start→enter gap never flash the modal. Hidden on re-entry.
  const [showFsWarning, setShowFsWarning] = useState(false);
  const fsWarnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (fsWarnTimer.current) {
      clearTimeout(fsWarnTimer.current);
      fsWarnTimer.current = null;
    }
    if (!fsSupported || !fsEnforced || fsIsFull) {
      setShowFsWarning(false);
      return;
    }
    fsWarnTimer.current = setTimeout(() => setShowFsWarning(true), 400);
    return () => {
      if (fsWarnTimer.current) clearTimeout(fsWarnTimer.current);
    };
  }, [fsIsFull, fsSupported, fsEnforced]);

  // Off-fullscreen kick: once the warning is showing (student stayed out of
  // fullscreen past the grace window), count down 10s; if they don't return,
  // save their progress and remove them from the test (resumable via Save & Exit).
  const [fsCountdown, setFsCountdown] = useState<number | null>(null);
  const fsKickRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!showFsWarning) {
      setFsCountdown(null);
      return;
    }
    let remaining = 10;
    setFsCountdown(remaining);
    const iv = setInterval(() => {
      remaining -= 1;
      setFsCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(iv);
        fsKickRef.current?.();
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [showFsWarning]);

  // ── Off-screen rule (midterms only) ─────────────────────────────────────────
  // Enforced only while the student is genuinely sitting the paper: never over the rules /
  // code / transition screens, never from a blocked duplicate tab, and never before the
  // module is on screen — every one of those is a place the runner itself moves focus or
  // fullscreen around, and an offence costs a third of the student's allowance.
  const offscreenEnforced =
    isMidterm &&
    !showWelcome &&
    !multiTab.blocked &&
    transitionTo === null &&
    !loading &&
    Boolean(currentQuestion) &&
    (attempt?.current_state === ATTEMPT_STATE.MODULE_1_ACTIVE ||
      attempt?.current_state === ATTEMPT_STATE.MODULE_2_ACTIVE);
  const offscreen = useOffscreenGuard({
    attemptId,
    attempt,
    enabled: offscreenEnforced,
    applyAttempt,
  });
  const goToMidtermResult = useCallback(
    () => router.push(`/midterm/result/${attemptId}`),
    [router, attemptId],
  );
  // Hold the terminal screen long enough to be read, then move on. The button on it does
  // the same thing immediately; the completion-routing effect stands down while it shows.
  useEffect(() => {
    if (!offscreen.terminated) return;
    const t = setTimeout(goToMidtermResult, 6000);
    return () => clearTimeout(t);
  }, [offscreen.terminated, goToMidtermResult]);

  // Keyboard shortcuts (pure input → existing handlers; no engine coupling).
  useKeyboardShortcuts({
    // `!reportOpen`: while the "Report a problem" dialog is open the exam UI stays
    // mounted underneath; without this, letter/arrow keys typed toward the dialog
    // would leak into the exam and silently change the graded answer / navigate.
    // `offscreen.countdown`: the off-screen warning covers the paper, so it must swallow the
    // keyboard too — the overlay blocks clicks by covering them, but an arrow key would sail
    // straight through and let a student keep working through their own warning.
    enabled:
      !loading &&
      Boolean(currentQuestion) &&
      transitionTo === null &&
      !multiTab.blocked &&
      !reportOpen &&
      offscreen.countdown === null,
    onPrev: guardedPrev,
    onNext: guardedNext,
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
    api: engineApi,
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

  // Pastpapers save in place (assessment-style): a short debounce for a
  // near-immediate per-answer save + a visible "Saved" indicator, and answers are
  // flushed to the server on leave (below). Mocks/midterms keep the longer default
  // and show no indicator (proctored — no save-and-resume affordance).
  const isPastpaper = pauseAllowed(attempt, mockFlow);

  // Autosave only while genuinely interactive (not submitting / transitioning /
  // paused, and never from a blocked duplicate tab).
  useAutosave({
    attempt,
    attemptId,
    answers,
    flagged,
    answersModuleId: moduleId,
    applyAttempt,
    // NOT gated on `paused`. Leaving the tab auto-pauses, and gating on that used
    // to switch the autosave off while an answer was still pending — stranding it
    // on exactly the leave path this feature exists to protect. A paused student
    // can't answer, so the effect doesn't re-run and this costs no extra traffic.
    enabled: !submitting && transitionTo === null && !multiTab.blocked,
    online,
    api: engineApi,
    debounceMs: isPastpaper ? 500 : undefined,
  });

  // Keep the call-time mirrors current on every render.
  attemptRef.current = attempt;
  answersRef.current = answers;
  flaggedRef.current = flagged;

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
      // A new module always begins running. The server now clears pause at the
      // module boundary, but the pause-sync effect above only reads is_paused
      // ONCE per attempt id, so it won't observe that reset — clear the local
      // flag here too, otherwise a pause left over from Module 1 would freeze
      // Module 2's timer.
      setPaused(false);
      const t = setTimeout(() => setTransitionTo(null), 1800);
      prevOrderRef.current = order;
      return () => clearTimeout(t);
    }
    if (order > 0) prevOrderRef.current = order;
  }, [attempt?.current_module_details?.module_order]);

  // ── Route out on completion (respecting mock flow) ──────────────────────────
  useEffect(() => {
    if (!attempt || !isCompleted(attempt)) return;
    // A sitting the off-screen rule ended is completed the instant the server takes the
    // paper in, and routing on that would replace the exam with the result page before the
    // student is told WHY. The terminal screen owns the redirect in that case.
    if (offscreen.terminated) return;
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
    // Midterms route to their own result page: standalone shows the score + certificate
    // immediately; a classroom midterm shows "awaiting release" until the teacher publishes.
    if (isMidterm) {
      router.push(`/midterm/result/${attemptId}`);
      return;
    }
    if (isMockSrc) {
      router.push(`/mock-exam/result/${attemptId}`);
      return;
    }
    router.push(`/review/${attemptId}`);
  }, [attempt, mockFlow, search, router, attemptId, isMidterm, isMockSrc, offscreen.terminated]);

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
      const snap = nextPaused ? await engineApi.pause(attemptId) : await engineApi.resumePause(attemptId);
      applyAttempt(snap);
    } catch {
      setPaused(!nextPaused); // revert on failure
    }
  }, [attempt, mockFlow, paused, attemptId, applyAttempt, engineApi]);

  // ── Save & Exit ─────────────────────────────────────────────────────────────
  // Force-majeure stop: persist current work (and pause the clock where allowed),
  // then leave. Returning to /exam/[id] resumes exactly where the student left
  // off. Uses the existing save/pause services — the engine itself is untouched.
  const [exiting, setExiting] = useState(false);
  const handleSaveAndExit = useCallback(async () => {
    setExiting(true);
    try {
      if (attemptRef.current && pauseAllowed(attemptRef.current, mockFlow)) {
        try {
          applyAttempt(await engineApi.pause(attemptId));
        } catch {
          /* best-effort pause */
        }
      }
      // Read version + answers from the refs, AFTER the pause await — a version
      // captured before it is stale the moment an autosave lands mid-await, and
      // save_attempt answers a stale version with a 409 that writes nothing.
      // Retry once against the server's own current version (it returns it on
      // conflict) so a lost race costs a round trip, not the student's work.
      const save = (version?: number) =>
        engineApi.saveAttempt(attemptId, answersRef.current, flaggedRef.current, {
          expectedVersionNumber: version,
        });
      try {
        applyAttempt(await save(attemptRef.current?.version_number));
      } catch (e) {
        // _version_conflict_response returns the canonical attempt alongside the
        // 409 precisely so a client can resync — use its version and save again.
        const fresh = (e as { response?: { status?: number; data?: { attempt?: { version_number?: number } } } })
          ?.response;
        if (fresh?.status !== 409 || typeof fresh?.data?.attempt?.version_number !== "number") throw e;
        applyAttempt(await save(fresh.data.attempt.version_number));
      }
    } catch {
      // The save genuinely failed. The local draft still holds the work (the
      // autosave never clears it), so resuming on this device recovers it.
    } finally {
      router.push("/");
    }
  }, [mockFlow, attemptId, applyAttempt, router, engineApi]);

  // Keep the off-fullscreen kick action current without restarting the countdown
  // when handleSaveAndExit's identity changes (e.g. on autosave).
  useEffect(() => {
    fsKickRef.current = handleSaveAndExit;
  }, [handleSaveAndExit]);

  // ── Answer-flush + auto-pause on leave ───────────────────────────────────────
  // Pastpapers are pausable and their module timer is wall-clock. If the student
  // leaves WITHOUT clicking "Save & Exit" — switches tab, closes the window, or
  // navigates away — the clock keeps burning, so on return the module has
  // "expired" and the runner auto-submits it (Module 1 silently skips to Module 2;
  // Module 2 submits the whole test). Mirror handleSaveAndExit's pause on the
  // implicit leave events so the student always resumes exactly where they stopped.
  // Mocks/midterms never auto-pause (pauseAllowed === false).
  const autoPauseRef = useRef<() => void>(() => {});
  autoPauseRef.current = () => {
    // NOTE: the answer FLUSH below runs for every flow (incl. mocks). Only the
    // pause step is pastpaper-only — see the pauseAllowed gate lower down. A mock
    // cannot pause, but it still must not lose the last answers on an abrupt leave
    // (they'd otherwise reach only the local draft, lost on cross-device resume).
    if (!attempt || !attemptId) return;
    const order = attempt.current_module_details?.module_order ?? 0;
    if (order <= 0 || isCompleted(attempt) || submitting || exiting) return;
    // Flush the LATEST answers to the server first (keepalive survives a tab
    // close), so an abrupt leave never loses them — resumable on any device, not
    // just this browser's local draft. Fires even if already paused (the student
    // may have answered more before leaving). Idempotent; the version guards a
    // stale write after a module advance. GUARDS: (a) a blocked/passive duplicate
    // tab must NOT flush — its `answers` are a stale snapshot and save_attempt
    // REPLACES, so it could clobber the primary tab's newer work (autosave is
    // disabled for it for the same reason); (b) skip an empty map — `answers`
    // hydrates from the server asynchronously on load, so flushing during that
    // window would blank saved work.
    // (c) don't flush mid module-transition: `answers` can still hold the previous
    // module's map for a frame while `attempt` is the new module, so a flush would
    // write them under the new module's key (harmless — foreign ids grade omitted —
    // but skipping it keeps the save robust-by-construction).
    // (d) send NO expected version. This is fire-and-forget — it cannot see a
    // 409, let alone retry one — and the autosave bumps version_number about
    // once a second, so pinning a version here mostly rejected the flush that
    // was meant to be the safety net. The guards above already cover what the
    // version was protecting against (a module advance), and the local draft
    // covers the rest.
    if (!multiTab.blocked && transitionTo === null && Object.keys(answers).length > 0) {
      engineApi.saveAttemptKeepalive(attemptId, answers, flagged);
    }
    // Pause is pastpaper-only; mocks/midterms never auto-pause (their clock burns
    // on leave by design). The answer flush above already ran for them.
    if (!pauseAllowed(attempt, mockFlow)) return;
    if (paused) return; // already frozen — only the answer flush was needed
    setPaused(true); // freeze the local countdown immediately
    engineApi.pauseKeepalive(attemptId); // persist; keepalive survives a tab close
  };
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") autoPauseRef.current();
    };
    const onPageHide = () => autoPauseRef.current();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      autoPauseRef.current(); // SPA navigation away: page stays alive — pause now
    };
  }, []);

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

  // The off-screen rule forfeited the sitting. The SERVER already submitted the paper —
  // this screen only explains it before the redirect (see the terminal-screen effect).
  if (offscreen.terminated) {
    return <OffscreenTerminatedScreen onContinue={goToMidtermResult} />;
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
  // Full-mock between-sections break (server-authoritative timer).
  if (isMockSrc && attempt && (attempt as unknown as { is_on_break?: boolean }).is_on_break) {
    const remaining = (attempt as unknown as { break_remaining_seconds?: number }).break_remaining_seconds ?? 0;
    return (
      <MockBreakScreen
        initialSeconds={remaining}
        onEnd={async () => {
          try {
            await mockApi.endBreak(attemptId);
          } catch {
            /* the reload below reconciles from the server */
          }
          reload();
        }}
      />
    );
  }
  if (isScoring(attempt)) {
    return <ScoringScreen notice={null} />;
  }
  // ── Start gate: rules → access code → Start ─────────────────────────────────
  // ONE block for both shapes of a not-yet-begun attempt: the midterm backend holds it in
  // NOT_STARTED (no module payload yet), the pastpaper backend auto-starts on create (module
  // already loaded). This used to be two near-identical blocks either side of the loading
  // guard, and every midterm change had to be made twice — which is how the reference-sheet
  // and predicate drift got in. The minutes/question-count fall back to the test's own
  // module 1 metadata, which is present in both shapes.
  if (showWelcome && !loading && attempt) {
    const activeModule = attempt.current_module_details;
    const startMinutes =
      activeModule?.time_limit_minutes ??
      attempt.practice_test_details.modules.find((m) => m.module_order === 1)?.time_limit_minutes;
    const startQuestionCount = activeModule?.questions.length;
    const subjLabel = subjectKind(attempt) === "MATH" ? "Math" : "Reading and Writing";
    if (isMidterm) {
      // Rules FIRST — the code screen is only reachable from it, so a student never types a
      // code before being told what they're agreeing to.
      if (codeGateOpen) {
        return (
          <MidtermCodeScreen
            onSubmitCode={verifyThenStart}
            onBack={() => setCodeGateOpen(false)}
            starting={starting}
            fullscreenSupported={tools.fullscreen.supported}
          />
        );
      }
      const details = attempt.practice_test_details as typeof attempt.practice_test_details & {
        scoring_scale?: string | null;
        pass_mark?: number | null;
        midterm_type?: string | null;
      };
      return (
        <MidtermRulesScreen
          title={details.title || moduleLabel(attempt)}
          subjectLabel={subjLabel}
          minutes={startMinutes}
          questionCount={startQuestionCount}
          starting={starting}
          fullscreenSupported={tools.fullscreen.supported}
          onProceed={() => void handleMidtermProceed()}
          scoringScale={details.scoring_scale ?? null}
          passMark={details.pass_mark ?? null}
          isRetake={details.midterm_type === "RETAKE"}
          // Unknown until the probe lands; assume a code IS needed so a classroom student is
          // never told to start without one they then get asked for.
          requiresCode={requiresCode !== false}
          calculatorEnabled={calculatorAllowed(attempt)}
        />
      );
    }
    return (
      <WelcomeScreen
        moduleTitle={moduleLabel(attempt)}
        subjectLabel={subjLabel}
        minutes={startMinutes}
        questionCount={startQuestionCount}
        starting={starting}
        fullscreenSupported={tools.fullscreen.supported}
        onStart={() => void handleStart()}
      />
    );
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

  // Check Your Work review page — shown before the module is submitted.
  if (reviewOpen) {
    const moduleOrder = attempt.current_module_details?.module_order ?? 1;
    const isLastModule = moduleOrder >= (attempt.practice_test_details.modules.length || 2);
    return (
      <CheckYourWorkPage
        moduleTitle={moduleLabel(attempt)}
        questions={questions}
        answers={answers}
        flagged={flagged}
        onJump={(i) => {
          goTo(i);
          setReviewOpen(false);
        }}
        onBack={() => setReviewOpen(false)}
        onSubmit={() => void submit()}
        submitting={submitting}
        isLastModule={isLastModule}
        submitLocked={isMidterm}
        studentName={studentName}
      />
    );
  }

  return (
    <div className="ts-runner flex h-screen flex-col bg-white">
      {/* The simulation fills the full viewport edge-to-edge — no side gutters or capped
          width. Shared by every exam type (pastpaper / practice / midterm / mock) since
          they all render this runner. */}
      <div className="flex h-full w-full flex-col bg-white">
      <div ref={topChromeRef} className="shrink-0">
      <ExamHeader
        moduleTitle={moduleLabel(attempt)}
        secondsLeft={secondsLeft}
        timerHidden={timerHidden}
        onToggleTimer={() => setTimerHidden((v) => !v)}
        timerWarning={warning}
        showDirections={showDirections}
        onToggleDirections={() => setShowDirections((v) => !v)}
        // Reference sheet: SAT Math only. Midterms never offer it (midtermRules.ts), and this
        // gate must read the unified predicate — keyed on the query param alone it leaked the
        // sheet into any midterm reached without it.
        mathTools={mathQuestions && !isMidterm}
        showCalculator={calculatorAllowed(attempt)}
        tools={tools}
        pauseAllowed={pauseAllowed(attempt, mockFlow)}
        paused={paused}
        onTogglePause={handlePauseToggle}
        onSaveAndExit={handleSaveAndExit}
        onReportProblem={currentQuestion ? () => setReportOpen(true) : undefined}

      />
      <SatColorRule />
      </div>

      <ReportProblemModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        target={currentQuestion ? { system: "exam", questionId: currentQuestion.id, attemptId } : null}
        questionNumber={currentIndex + 1}
      />

      <main
        ref={mainRef}
        className={`flex min-h-0 flex-1 overflow-hidden ${tools.highlighterActive ? "ts-annotating [&_#ts-passage]:cursor-text [&_#ts-question]:cursor-text [&_#ts-choices]:cursor-text" : ""}`}
      >
        {twoPane ? (
          <>
            <PassagePane question={currentQuestion} zoom={zoom} style={{ width: `${splitPct}%`, flex: "none" }} />
            <div
              onMouseDown={onDividerDown}
              className="relative w-[2px] shrink-0 cursor-col-resize select-none bg-slate-300"
              role="separator"
              aria-orientation="vertical"
            >
              {/* Bluebook drag handle (dark pill with double-arrow). */}
              <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-11 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-[#1b1b1b] text-white">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                  <path d="M8 7l-5 5 5 5V7z" />
                  <path d="M16 7l5 5-5 5V7z" />
                </svg>
              </span>
            </div>
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
          <>
            {/* Calculator floats over the content (see ExamToolsLayer); it never
                reserves layout space, so the question column stays stable. */}
            {/* Student-Produced Response Directions — left column, SPR questions
                only (item: SPR Directions Panel). Collapsible to give the
                question more width; state persists across SPR questions. */}
            {isStudentProducedResponse(currentQuestion) && (
              <div
                className="h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-out"
                // Expanded: exactly half the screen (percentage, no px cap) so the
                // directions + question split stays 50/50 and centered at any size.
                style={{ width: sprGuideExpanded ? "50%" : "3rem" }}
              >
                <StudentProducedResponseGuide expanded={sprGuideExpanded} onToggle={toggleSprGuide} />
              </div>
            )}
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
              style={{ flex: "1 1 0%", minWidth: 0 }}
              // SPR questions already show the directions panel on the left, so
              // don't also reserve calculator space (that pushes the question
              // off-screen); Desmos floats over the directions instead.
              calcReserve={
                tools.calculatorOpen && !isStudentProducedResponse(currentQuestion)
                  ? tools.calculatorEnlarged
                    ? 760
                    : 500
                  : 0
              }
            />
          </>
        )}
      </main>

      <SatColorRule />
      <ExamFooter
        navLabel={`Question ${currentIndex + 1} of ${questions.length}`}
        onToggleNavigator={() => setNavigatorOpen((v) => !v)}
        canGoBack={currentIndex > 0}
        onBack={guardedPrev}
        isLastQuestion={currentIndex === questions.length - 1}
        onNext={guardedNext}
        onSubmitModule={() => setReviewOpen(true)}
        submitting={submitting}
        studentName={studentName}
        navLocked={navLocked}
      />
      </div>

      <QuestionNavigator
        open={navigatorOpen}
        onClose={() => setNavigatorOpen(false)}
        title={moduleLabel(attempt)}
        questions={questions}
        currentIndex={currentIndex}
        answers={answers}
        flagged={flagged}
        onJump={goTo}
        onGoToReview={() => setReviewOpen(true)}
      />

      {/* Directions popover — hangs from the header's "Directions" button, covers
          the passage region, and leaves the question visible (Bluebook). */}
      {showDirections && (
        <DirectionsOverlay
          anchorBottom={dirTop}
          widthPct={twoPane ? splitPct : 50}
          subject={subjectKind(attempt)}
          onClose={() => setShowDirections(false)}
        />
      )}

      {/* All SAT-experience tool overlays (calculator, reference, notes, help,
          highlight popover). Single mount point; each is engine-isolated. */}
      <ExamToolsLayer tools={tools} attemptId={attemptId} />

      {/* Forced fullscreen — if the student leaves fullscreen mid-test, block the
          UI until they re-enter (the only path is a user-gesture button). Gated on
          a short grace window (showFsWarning) so it never flickers during the
          native fullscreen transition. Unsupported browsers never see this. */}
      {showFsWarning && (
        <FullscreenWarning secondsLeft={fsCountdown ?? undefined} onReturn={() => void tools.fullscreen.enter()} />
      )}

      {/* Off-screen rule (midterms). Covers everything, including the fullscreen warning it
          replaces, and stays up until the student is back — the guard detects that itself. */}
      {offscreen.countdown !== null && (
        <OffscreenWarning
          secondsLeft={offscreen.countdown}
          chancesLeft={offscreen.chancesLeft}
          showReturnToFullscreen={tools.fullscreen.supported && !tools.fullscreen.isFullscreen}
          onReturnToFullscreen={() => void tools.fullscreen.enter()}
        />
      )}

      {/* Returned in time: the warning is gone, so say what it cost — otherwise the student
          only finds out they were on their last chance by losing the paper. */}
      {offscreen.notice && (
        <div role="alert" className="fixed inset-x-0 top-20 z-[70] flex justify-center px-4">
          <div className="flex max-w-lg items-center gap-4 rounded-xl border border-red-200 bg-white px-5 py-3 shadow-xl">
            <span className="text-sm font-semibold text-slate-700">{offscreen.notice}</span>
            <button
              type="button"
              onClick={offscreen.dismissNotice}
              className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
            >
              Got it
            </button>
          </div>
        </div>
      )}

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
