import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bookmark,
  Calculator,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  EyeOff,
  Flag,
  HelpCircle,
  Highlighter,
  LogOut,
  MapPin,
  MoreVertical,
  Pause,
  PenLine,
  Play,
  StickyNote,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { Attempt, ExamQuestion } from "./types";
import { formatClock, isReadingWriting, isStudentResponse, parseOptions } from "./util";
import { renderExamHtml, SafeHtml } from "./richText";
import { SatColorRule } from "./SatColorRule";
import { useCountdown, useRunner, type RunnerState } from "./useExamState";

/**
 * The native exam runner, matched 1:1 to the website's testing-simulation runner: the SAT
 * multi-colour rule, the Georgia serif reading surface, the number-block + grey-band question
 * header with the ABC answer eliminator, the draggable Reading & Writing split, and the anchored
 * question navigator. Logic (the server contract, timing, module state) is preserved; this is the
 * fresh UI over it.
 *
 * `mode="midterm"` is the site's midterm runner: no pause, no Save & Exit, no early hand-in (the
 * review page says so), copying off, and the paper is inert while the off-screen warning covers it.
 * Every mode submits a module by itself when its time runs out.
 *
 * Importers: exam/ExamScreen.tsx (past papers), exam/midterm/MidtermScreen.tsx.
 */

export function ExamRunner({
  attempt,
  submitting,
  onSave,
  onSubmit,
  onExit,
  mode = "practice",
  studentName = "",
  headerExtra,
  banner,
  inert = false,
  onTransitionChange,
}: {
  attempt: Attempt;
  submitting: boolean;
  onSave: (answers: Record<string, string>, flagged: number[]) => void;
  onSubmit: (answers: Record<string, string>, flagged: number[]) => Promise<void> | void;
  onExit: () => void;
  mode?: "practice" | "midterm";
  /** The signed-in student, shown bottom-left as on the site. */
  studentName?: string;
  /** Extra header item, right of the tools (the battery reading). */
  headerExtra?: ReactNode;
  /** Strips under the header (low battery, reconnecting). */
  banner?: ReactNode;
  /** The off-screen warning covers the paper: nothing under it may take a click or a key. */
  inert?: boolean;
  /** The between-module interstitial is showing (the off-screen guard stands down for it). */
  onTransitionChange?: (transitioning: boolean) => void;
}) {
  const isMidterm = mode === "midterm";
  const mod = attempt.current_module_details;
  const r = useRunner(attempt);
  const remaining = useCountdown(attempt);

  const [timerHidden, setTimerHidden] = useState(false);
  const [paused, setPaused] = useState(false);
  const [eliminationMode, setEliminationMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [navOpen, setNavOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [splitPct, setSplitPct] = useState(50);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const answersOut = (): Record<string, string> => Object.fromEntries(Object.entries(r.answers)) as Record<string, string>;
  const flaggedOut = (): number[] => Array.from(r.flagged);

  // Autosave: a change to answers or flags is written (debounced) through the parent.
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    const answers = answersOut();
    const flagged = flaggedOut();
    const t = setTimeout(() => onSave(answers, flagged), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.answers, r.flagged]);

  // Close the review and play a short transition when the module advances.
  const moduleId = mod?.id ?? 0;
  const prevOrder = useRef(mod?.module_order ?? 1);
  useEffect(() => {
    setReviewOpen(false);
    const order = mod?.module_order ?? 1;
    if (order > prevOrder.current) {
      setTransitioning(true);
      const t = setTimeout(() => setTransitioning(false), 1600);
      prevOrder.current = order;
      return () => clearTimeout(t);
    }
    prevOrder.current = order;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  useEffect(() => {
    onTransitionChange?.(transitioning);
  }, [transitioning, onTransitionChange]);

  // Time is up: the module submits itself, once per module. A midterm has no other way in — the
  // server refuses an early hand-in — and on a past paper it is what the clock running out means.
  const autoSubmitted = useRef<number | null>(null);
  useEffect(() => {
    if (remaining > 0 || !mod || autoSubmitted.current === mod.id) return;
    autoSubmitted.current = mod.id;
    void Promise.resolve(onSubmit(answersOut(), flaggedOut())).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, mod?.id]);

  // While the off-screen warning covers the paper, nothing under it may take a click or a key.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (inert) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [inert]);

  // A midterm's text stays on the screen: no copying it out, no context menu.
  useEffect(() => {
    if (!isMidterm) return;
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("copy", block);
    document.addEventListener("cut", block);
    document.addEventListener("contextmenu", block);
    return () => {
      document.removeEventListener("copy", block);
      document.removeEventListener("cut", block);
      document.removeEventListener("contextmenu", block);
    };
  }, [isMidterm]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current || !bodyRef.current) return;
      const rect = bodyRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.max(28, Math.min(72, pct)));
    };
    const up = () => (dragging.current = false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  if (!mod || mod.questions.length === 0) {
    return <div className="flex h-screen items-center justify-center bg-white text-slate-500">This module has no questions.</div>;
  }

  const isMath = !isReadingWriting(attempt.practice_test_details.subject);
  const count = mod.questions.length;
  // On a module change the saved index can briefly exceed the new module's question count (the
  // reset runs in an effect, after this render), so clamp it here to avoid reading past the end.
  const index = Math.min(r.index, count - 1);
  const q = mod.questions[index];
  const isLastModule = mod.module_order >= (attempt.practice_test_details.modules?.length ?? 2);
  const subjectLabel = isMath ? "Mathematics" : "Reading & Writing";
  const submit = () => void Promise.resolve(onSubmit(answersOut(), flaggedOut())).catch(() => {});
  const warning = remaining <= 300;
  const moduleTitle = `Section ${isMath ? 2 : 1}, Module ${mod.module_order}: ${isMath ? "Math" : "Reading and Writing"}`;

  const zoomIn = () => setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 10) / 10));
  const zoomOut = () => setZoom((z) => Math.max(0.8, Math.round((z - 0.1) * 10) / 10));

  return (
    // `ts-runner`: the site's runner chrome face (the Bluebook sans stack); the passage, stem and
    // choices opt back into Georgia themselves. Same class, same place as ExamRunnerPage.tsx.
    <div ref={rootRef} className="ts-runner relative flex h-screen flex-col overflow-hidden bg-white text-slate-900">
      {/* ── Header ── */}
      <header className="grid shrink-0 grid-cols-3 items-center bg-white px-6 py-3">
        <div className="flex flex-col items-start">
          <h1 className="text-base font-bold tracking-tight text-slate-900">{moduleTitle}</h1>
          <button type="button" className="mt-0.5 inline-flex items-center gap-1 text-[15px] text-slate-800 hover:text-slate-950">
            Directions <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        <div className="flex justify-center">
          <Timer
            secondsLeft={remaining}
            hidden={timerHidden}
            warning={warning}
            paused={paused}
            canPause={!isMidterm}
            onToggleHidden={() => setTimerHidden((v) => !v)}
            onTogglePause={() => setPaused((v) => !v)}
          />
        </div>

        <div className="relative flex items-center justify-end gap-6">
          {headerExtra}
          {isMath ? (
            <ToolButton label="Calculator" onClick={() => {}}>
              <Calculator className="h-5 w-5" />
            </ToolButton>
          ) : null}
          <ToolButton label="Highlights & Notes" onClick={() => {}}>
            <PenLine className="h-[18px] w-[18px]" />
          </ToolButton>
          <ToolButton label="More" onClick={() => setMoreOpen((v) => !v)}>
            <MoreVertical className="h-5 w-5" />
          </ToolButton>
          {moreOpen ? (
            <MoreMenu
              onClose={() => setMoreOpen(false)}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onSaveExit={isMidterm ? undefined : onExit}
            />
          ) : null}
        </div>
      </header>

      <SatColorRule />
      {banner}

      {/* ── Body ── */}
      <div ref={bodyRef} className="flex min-h-0 flex-1">
        {isMath ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <AnswerPane q={q} number={index + 1} r={r} isMath zoom={zoom} eliminationMode={eliminationMode} onToggleElim={() => setEliminationMode((v) => !v)} />
          </div>
        ) : (
          <>
            <div className="min-h-0 overflow-hidden" style={{ width: `${splitPct}%` }}>
              <PassagePane q={q} zoom={zoom} />
            </div>
            <div className="relative w-px shrink-0 bg-slate-200">
              <button
                type="button"
                aria-label="Resize panes"
                onPointerDown={(e) => {
                  dragging.current = true;
                  e.preventDefault();
                }}
                className="absolute left-1/2 top-1/2 flex h-12 w-6 -translate-x-1/2 -translate-y-1/2 cursor-col-resize items-center justify-center rounded-md bg-[#151515] text-white"
              >
                <span className="text-xs leading-none">‹›</span>
              </button>
            </div>
            <div className="min-h-0 overflow-hidden" style={{ width: `${100 - splitPct}%` }}>
              <AnswerPane q={q} number={index + 1} r={r} isMath={false} zoom={zoom} eliminationMode={eliminationMode} onToggleElim={() => setEliminationMode((v) => !v)} />
            </div>
          </>
        )}
      </div>

      <SatColorRule />

      {/* ── Footer ── */}
      <footer className="flex shrink-0 items-center justify-between bg-white px-6 py-3">
        <div className="flex flex-1 items-center">
          <span className="truncate text-[15px] font-bold text-slate-700">{studentName}</span>
        </div>
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full bg-[#151515] px-6 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#2a2a2a]"
          >
            Question {index + 1} of {count}
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-end gap-3">
          <button
            type="button"
            onClick={r.prev}
            disabled={index === 0 || submitting}
            className="rounded-full bg-[#253985] px-9 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#1d2d6b] disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => (index === count - 1 ? setReviewOpen(true) : r.next())}
            disabled={submitting}
            className="rounded-full bg-[#253985] px-9 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#1d2d6b] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </footer>

      {navOpen ? (
        <Navigator
          title={moduleTitle}
          questions={mod.questions}
          r={r}
          onClose={() => setNavOpen(false)}
          onGoReview={() => setReviewOpen(true)}
        />
      ) : null}

      {reviewOpen ? (
        <CheckYourWork
          title={moduleTitle}
          questions={mod.questions}
          r={r}
          isLastModule={isLastModule}
          submitting={submitting}
          locked={isMidterm}
          onBack={() => setReviewOpen(false)}
          onJump={(i) => {
            r.goTo(i);
            setReviewOpen(false);
          }}
          onSubmit={submit}
        />
      ) : null}

      {transitioning ? <TransitionOverlay order={mod.module_order} subject={subjectLabel} /> : null}
    </div>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-0.5 text-xs font-semibold text-slate-900 hover:text-slate-600">
      {children}
      {label}
    </button>
  );
}

const PILL =
  "inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-0.5 text-xs font-semibold text-slate-600 hover:border-slate-400";

function Timer({
  secondsLeft,
  hidden,
  warning,
  paused,
  canPause,
  onToggleHidden,
  onTogglePause,
}: {
  secondsLeft: number;
  hidden: boolean;
  warning: boolean;
  paused: boolean;
  /** A midterm's clock cannot be paused. */
  canPause: boolean;
  onToggleHidden: () => void;
  onTogglePause: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      {hidden ? (
        <Clock className={`h-7 w-7 ${warning ? "text-red-600" : "text-slate-500"}`} aria-hidden />
      ) : (
        <div className={`text-[26px] font-bold leading-none tabular-nums tracking-[0.02em] ${warning ? "text-red-600" : "text-slate-900"}`}>
          {formatClock(secondsLeft)}
        </div>
      )}
      {warning ? (
        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-700">
          Less than 5 minutes
        </span>
      ) : null}
      <div className="flex items-center gap-2">
        <button type="button" onClick={onToggleHidden} className={PILL}>
          {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {hidden ? "Show" : "Hide"}
        </button>
        {canPause ? (
          <button type="button" onClick={onTogglePause} className={PILL}>
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? "Resume" : "Pause"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MoreMenu({
  onClose,
  onZoomIn,
  onZoomOut,
  onSaveExit,
}: {
  onClose: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Absent for a midterm: it has no Save & Exit (the site's saveExitAllowed={!isMidterm}). */
  onSaveExit?: () => void;
}) {
  const item = "flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] font-semibold text-slate-800 hover:bg-slate-50";
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute right-0 top-[52px] z-40 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
        <button className={item} onClick={onClose}>
          <Highlighter className="h-[18px] w-[18px] text-slate-500" /> Highlighter: Off
        </button>
        <button className={item} onClick={onClose}>
          <StickyNote className="h-[18px] w-[18px] text-slate-500" /> Notes
        </button>
        <button className={item} onClick={onClose}>
          <Flag className="h-[18px] w-[18px] text-slate-500" /> Report a problem
        </button>
        <button className={item} onClick={() => { onZoomIn(); onClose(); }}>
          <ZoomIn className="h-[18px] w-[18px] text-slate-500" /> Zoom in
        </button>
        <button className={item} onClick={() => { onZoomOut(); onClose(); }}>
          <ZoomOut className="h-[18px] w-[18px] text-slate-500" /> Zoom out
        </button>
        <button className={item} onClick={onClose}>
          <HelpCircle className="h-[18px] w-[18px] text-slate-500" /> Keyboard shortcuts
        </button>
        {onSaveExit ? (
          <>
            <div className="my-1 h-px bg-slate-100" />
            <button className={item} onClick={() => { onClose(); onSaveExit(); }}>
              <LogOut className="h-[18px] w-[18px] text-slate-500" /> Save &amp; Exit
            </button>
          </>
        ) : null}
      </div>
    </>
  );
}

function PassagePane({ q, zoom }: { q: ExamQuestion; zoom: number }) {
  return (
    <div className="h-full min-w-0 overflow-y-auto p-10" style={{ fontSize: `${17 * zoom}px` }}>
      <div className="max-w-none leading-relaxed text-slate-900">
        {q.question_image ? (
          <div className="mb-6 flex justify-center rounded-lg border border-slate-100 bg-slate-50 p-4">
            <img src={q.question_image} alt="" className="max-h-[400px] max-w-full object-contain" />
          </div>
        ) : null}
        <SafeHtml block className="font-[Georgia] font-medium leading-relaxed" html={renderExamHtml(q.question_text)} />
      </div>
    </div>
  );
}

function AnswerPane({
  q,
  number,
  r,
  isMath,
  zoom,
  eliminationMode,
  onToggleElim,
}: {
  q: ExamQuestion;
  number: number;
  r: RunnerState;
  isMath: boolean;
  zoom: number;
  eliminationMode: boolean;
  onToggleElim: () => void;
}) {
  const isSpr = isStudentResponse(q);
  const flagged = r.flagged.has(q.id);
  return (
    <div className="h-full min-w-0 overflow-y-auto overflow-x-hidden bg-white p-10 pb-8" style={{ fontSize: `${15 * zoom}px` }}>
      <div className="mx-auto w-full max-w-3xl">
        {/* Question header: black number block + grey band. */}
        <div className="flex items-stretch overflow-hidden rounded-[3px]">
          <span className="flex items-center bg-[#151515] px-3 py-1.5 text-lg font-bold tracking-tight text-white">{number}</span>
          <div className="flex flex-1 items-center justify-between bg-[#eceef1] px-3">
            <button
              type="button"
              onClick={() => r.toggleFlag(q.id)}
              className={`flex items-center gap-2 text-[15px] transition-colors ${flagged ? "font-bold text-[#b0122a] underline underline-offset-[3px]" : "text-slate-700 hover:text-slate-900"}`}
            >
              <Bookmark className={`h-[19px] w-[17px] ${flagged ? "fill-[#b0122a] text-[#b0122a]" : "fill-none text-slate-500"}`} />
              {flagged ? "Marked for Review" : "Mark for Review"}
            </button>
            {!isSpr ? (
              <button
                type="button"
                onClick={onToggleElim}
                title="Cross out answer choices"
                aria-pressed={eliminationMode}
                className={`relative flex h-[26px] w-[34px] items-center justify-center rounded-[5px] border-[1.5px] transition-colors ${eliminationMode ? "border-[#2b47c9] bg-[#2b47c9] text-white" : "border-slate-500 bg-white text-slate-800 hover:border-slate-700"}`}
              >
                <span className="text-[11px] font-extrabold italic leading-none tracking-tight">ABC</span>
                <span className="absolute left-[3px] right-[3px] top-1/2 h-[1.6px] -translate-y-1/2 -rotate-[10deg] bg-current" />
              </button>
            ) : null}
          </div>
        </div>

        <SatColorRule className="mb-8 mt-0" />

        {isMath && q.question_image ? (
          <div className="mb-6 flex justify-center">
            <img src={q.question_image} alt="" className="max-h-[360px] max-w-full rounded-lg border border-slate-100 bg-slate-50 object-contain p-2" />
          </div>
        ) : null}

        {q.question_prompt && !isSpr && !isMath ? (
          <SafeHtml block className="mb-8 font-[Georgia] font-medium leading-relaxed text-slate-900" style={{ fontSize: `${16 * zoom * 1.2}px` }} html={renderExamHtml(q.question_prompt)} />
        ) : null}
        {isMath ? (
          <SafeHtml block className="mb-8 font-[Georgia] font-medium leading-relaxed text-slate-900" style={{ fontSize: `${16 * zoom * 1.2}px` }} html={renderExamHtml(q.question_text)} />
        ) : null}

        {isSpr ? (
          <SprInput q={q} r={r} />
        ) : (
          <ChoiceList q={q} r={r} eliminationMode={eliminationMode} />
        )}
      </div>
    </div>
  );
}

function ChoiceList({ q, r, eliminationMode }: { q: ExamQuestion; r: RunnerState; eliminationMode: boolean }) {
  const options = parseOptions(q.options);
  const selected = r.answers[q.id];
  const elim = r.eliminated[q.id] ?? new Set<string>();
  return (
    <div className="w-full space-y-4">
      {options.map(({ key, text, image }) => {
        const isSelected = selected === key;
        const isEliminated = elim.has(key);
        return (
          <div key={key} className="group relative flex items-center gap-3">
            <button
              type="button"
              onClick={() => !isEliminated && r.select(q.id, key)}
              aria-pressed={isSelected}
              className={`relative flex min-h-[56px] flex-1 items-center rounded-[11px] transition-colors ${
                isSelected
                  ? "border-2 border-[#2b47c9] bg-[#f2f5fd] px-[17px] py-3"
                  : isEliminated
                    ? "cursor-not-allowed border border-slate-200 bg-white px-[18px] py-[13px]"
                    : "border border-[#c8ccd4] bg-white px-[18px] py-[13px] hover:border-slate-400"
              }`}
            >
              <span
                className={`flex h-[29px] w-[29px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[15px] font-semibold ${
                  isSelected
                    ? "border-[#2b47c9] bg-[#2b47c9] text-white"
                    : isEliminated
                      ? "border-slate-300 text-slate-400"
                      : "border-[#757b86] text-slate-800"
                }`}
              >
                {key}
              </span>
              <span className={`ml-4 w-full text-left font-[Georgia] text-[16px] leading-snug ${isEliminated ? "text-slate-400" : "text-slate-900"}`}>
                {image ? (
                  <img src={image} alt={`Option ${key}`} className="max-h-[200px] max-w-full rounded-lg border border-slate-100 object-contain shadow-sm" />
                ) : (
                  <SafeHtml html={renderExamHtml(text)} />
                )}
              </span>
              {isEliminated ? (
                <span className="pointer-events-none absolute inset-x-1 top-1/2 h-[2px] -translate-y-1/2 bg-[#333]" aria-hidden />
              ) : null}
            </button>

            {eliminationMode ? (
              isEliminated ? (
                <button
                  type="button"
                  onClick={() => r.toggleEliminate(q.id, key)}
                  className="shrink-0 text-sm font-bold text-slate-900 underline underline-offset-2 hover:text-slate-700"
                >
                  Undo
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => r.toggleEliminate(q.id, key)}
                  title={`Eliminate ${key}`}
                  aria-label={`Eliminate ${key}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-400 text-slate-600 transition-colors hover:border-slate-600 hover:text-slate-900"
                >
                  <span className="relative text-xs font-bold leading-none">
                    {key}
                    <span className="absolute left-1/2 top-1/2 h-px w-5 -translate-x-1/2 -translate-y-1/2 bg-current" />
                  </span>
                </button>
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RecordedAnswer({ text }: { text: string }) {
  if (!text) return <span>—</span>;
  if (text.includes("/")) {
    const [num, den] = text.split("/");
    return (
      <span className="inline-flex flex-col items-center justify-center font-black leading-none">
        <span className="border-b-[2.5px] border-slate-900 px-[2px] pb-[1px]">{num}</span>
        <span className="px-[2px] pt-[1px]">{den}</span>
      </span>
    );
  }
  return <span>{text}</span>;
}

function SprInput({ q, r }: { q: ExamQuestion; r: RunnerState }) {
  const value = r.answers[q.id] ?? "";
  return (
    <div className="mt-6">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">Your Answer</p>
      <input
        type="text"
        inputMode="text"
        placeholder="Enter your answer"
        maxLength={5}
        value={value}
        onChange={(e) => {
          const next = e.target.value.slice(0, 5);
          if (/^[-0-9./]*$/.test(next)) r.select(q.id, next);
        }}
        className="w-full max-w-xs rounded-lg border-2 border-slate-300 p-3 px-4 text-center text-xl font-bold tracking-widest text-slate-900 shadow-sm outline-2 outline-offset-1 outline-blue-600 transition-all hover:border-slate-400 focus:border-blue-600 focus:outline"
      />
      <div className="mt-3 flex max-w-xs items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Recorded:</span>
        <span className="flex min-h-[30px] min-w-[30px] items-center justify-center rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-sm font-black text-slate-900">
          <RecordedAnswer text={value} />
        </span>
      </div>
    </div>
  );
}

function Navigator({
  title,
  questions,
  r,
  onClose,
  onGoReview,
}: {
  title: string;
  questions: ExamQuestion[];
  r: RunnerState;
  onClose: () => void;
  onGoReview: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/20 pb-[68px]" onClick={onClose}>
      <div className="relative mx-4 w-full max-w-xl rounded-[3px] bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-8 border-t-8 border-x-transparent border-t-white" />
        <div className="relative mb-4">
          <h3 className="px-8 text-center text-lg font-bold tracking-tight text-slate-900">{title} Questions</h3>
          <button type="button" onClick={onClose} className="absolute right-0 top-0 text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-5 flex items-center justify-center gap-6 border-b border-slate-100 pb-3 text-sm font-semibold text-slate-600">
          <span className="flex items-center gap-1.5">
            <MapPin className="h-4 w-4 fill-slate-800 text-slate-800" /> Current
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3.5 w-3.5 rounded-sm border border-dashed border-slate-400" /> Unanswered
          </span>
          <span className="flex items-center gap-1.5">
            <Flag className="h-4 w-4 fill-red-500 text-red-500" /> For Review
          </span>
        </div>
        <div className="grid grid-cols-10 gap-3 pt-3">
          {questions.map((qq, i) => {
            const answered = !!r.answers[qq.id];
            const isCurrent = i === r.index;
            const isFlagged = r.flagged.has(qq.id);
            return (
              <div key={qq.id} className="relative flex justify-center">
                {isCurrent ? <MapPin className="absolute -top-3 left-1/2 h-4 w-4 -translate-x-1/2 fill-slate-800 text-slate-800" aria-hidden /> : null}
                <button
                  type="button"
                  onClick={() => {
                    r.goTo(i);
                    onClose();
                  }}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-[10px] text-sm font-bold transition-colors ${
                    answered ? "border border-[#253985] bg-[#253985] text-white" : "border border-dashed border-slate-400 text-[#2b47c9] hover:border-slate-600"
                  } ${isCurrent ? "underline underline-offset-2" : ""}`}
                >
                  {i + 1}
                  {isFlagged ? <Flag className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 fill-red-500 text-red-500" aria-hidden /> : null}
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-5 flex justify-center border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => {
              onClose();
              onGoReview();
            }}
            className="rounded-full border-2 border-[#2b47c9] px-6 py-2 text-sm font-bold text-[#2b47c9] transition-colors hover:bg-blue-50"
          >
            Go to Review Page
          </button>
        </div>
      </div>
    </div>
  );
}

/** The Bluebook "Check Your Work" review page, shown before submitting a module. */
function CheckYourWork({
  title,
  questions,
  r,
  isLastModule,
  submitting,
  locked,
  onBack,
  onJump,
  onSubmit,
}: {
  title: string;
  questions: ExamQuestion[];
  r: RunnerState;
  isLastModule: boolean;
  submitting: boolean;
  /** A midterm: no early hand-in — the module submits itself when time runs out. */
  locked: boolean;
  onBack: () => void;
  onJump: (i: number) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col overflow-y-auto bg-white">
      <SatColorRule />
      <div className="mx-auto w-full max-w-3xl flex-1 px-8 py-12">
        <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">Check Your Work</h2>
        <p className="mx-auto mt-3 max-w-md text-center text-[15px] text-slate-600">
          On test day, you won’t be able to move on to the next module until time expires. Review your work for{" "}
          {title}.
        </p>

        <div className="mx-auto mt-8 flex max-w-xs items-center justify-center gap-6 border-y border-slate-100 py-3 text-sm font-semibold text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="h-3.5 w-3.5 rounded-sm border border-dashed border-slate-400" /> Unanswered
          </span>
          <span className="flex items-center gap-1.5">
            <Flag className="h-4 w-4 fill-red-500 text-red-500" /> For Review
          </span>
        </div>

        <div className="mt-8 grid grid-cols-8 gap-3">
          {questions.map((qq, i) => {
            const answered = !!r.answers[qq.id];
            const isFlagged = r.flagged.has(qq.id);
            return (
              <div key={qq.id} className="relative flex justify-center">
                <button
                  type="button"
                  onClick={() => onJump(i)}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-[10px] text-sm font-bold transition-colors ${
                    answered ? "border border-[#253985] bg-[#253985] text-white" : "border border-dashed border-slate-400 text-[#2b47c9] hover:border-slate-600"
                  }`}
                >
                  {i + 1}
                  {isFlagged ? <Flag className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 fill-red-500 text-red-500" aria-hidden /> : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <SatColorRule />
      <footer className="flex shrink-0 items-center justify-between bg-white px-6 py-3">
        <div className="flex-1" />
        <button
          type="button"
          onClick={onBack}
          className="rounded-full bg-[#151515] px-6 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#2a2a2a]"
        >
          Back to the module
        </button>
        <div className="flex flex-1 justify-end">
          {locked ? (
            <p className="max-w-xs text-right text-[13px] font-semibold leading-snug text-slate-600">
              {submitting
                ? "Submitting…"
                : "Keep reviewing your answers — you can't submit early. The midterm submits automatically when time runs out."}
            </p>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="rounded-full bg-[#253985] px-9 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#1d2d6b] disabled:opacity-50"
            >
              {submitting ? "Submitting…" : isLastModule ? "Submit" : "Next Module"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

/** The short "Continuing to Module N" interstitial between modules. */
function TransitionOverlay({ order, subject }: { order: number; subject: string }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Moving on</p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900">Continuing to Module {order}</h2>
      <p className="mt-2 text-[15px] text-slate-600">{subject}</p>
    </div>
  );
}
