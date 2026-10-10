import { useEffect, useRef, useState } from "react";
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
import { useCountdown, useRunner, type RunnerState } from "./useExamState";

/**
 * The native exam runner, matched 1:1 to the website's testing-simulation runner: the SAT
 * multi-colour rule, the Georgia serif reading surface, the number-block + grey-band question
 * header with the ABC answer eliminator, the draggable Reading & Writing split, and the anchored
 * question navigator. Logic (the server contract, timing, module state) is preserved; this is the
 * fresh UI over it. Autosave, submit, the review page and the midterm lockdown are the next slices.
 */

/** The Bluebook multi-colour dashed rule — top and bottom edges, and under the question header. */
function SatColorRule({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`h-[3px] w-full shrink-0 ${className}`}
      style={{
        background:
          "repeating-linear-gradient(to right, #b91c1c 0, #b91c1c 48px, transparent 48px, transparent 54px, #ca8a04 54px, #ca8a04 102px, transparent 102px, transparent 108px, #15803d 108px, #15803d 156px, transparent 156px, transparent 162px, #0f172a 162px, #0f172a 210px, transparent 210px, transparent 216px)",
      }}
    />
  );
}

export function ExamRunner({ attempt, onExit }: { attempt: Attempt; onExit: () => void }) {
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
  const q = mod.questions[r.index];
  const count = mod.questions.length;
  const warning = remaining <= 300;
  const moduleTitle = `Section ${isMath ? 2 : 1}, Module ${mod.module_order}: ${isMath ? "Math" : "Reading and Writing"}`;

  const zoomIn = () => setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 10) / 10));
  const zoomOut = () => setZoom((z) => Math.max(0.8, Math.round((z - 0.1) * 10) / 10));

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-white text-slate-900">
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
            onToggleHidden={() => setTimerHidden((v) => !v)}
            onTogglePause={() => setPaused((v) => !v)}
          />
        </div>

        <div className="relative flex items-center justify-end gap-6">
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
              onSaveExit={onExit}
            />
          ) : null}
        </div>
      </header>

      <SatColorRule />

      {/* ── Body ── */}
      <div ref={bodyRef} className="flex min-h-0 flex-1">
        {isMath ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <AnswerPane q={q} number={r.index + 1} r={r} isMath zoom={zoom} eliminationMode={eliminationMode} onToggleElim={() => setEliminationMode((v) => !v)} />
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
              <AnswerPane q={q} number={r.index + 1} r={r} isMath={false} zoom={zoom} eliminationMode={eliminationMode} onToggleElim={() => setEliminationMode((v) => !v)} />
            </div>
          </>
        )}
      </div>

      <SatColorRule />

      {/* ── Footer ── */}
      <footer className="flex shrink-0 items-center justify-between bg-white px-6 py-3">
        <div className="flex flex-1 items-center">
          <span className="truncate text-[15px] font-bold text-slate-700">Alisher Muhammadaliyev</span>
        </div>
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full bg-[#151515] px-6 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#2a2a2a]"
          >
            Question {r.index + 1} of {count}
            <ChevronUp className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-end gap-3">
          <button
            type="button"
            onClick={r.prev}
            disabled={r.index === 0}
            className="rounded-full bg-[#253985] px-9 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#1d2d6b] disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={r.next}
            disabled={r.index === count - 1}
            className="rounded-full bg-[#253985] px-9 py-2.5 text-[15px] font-bold text-white transition-colors hover:bg-[#1d2d6b] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </footer>

      {navOpen ? (
        <Navigator title={moduleTitle} questions={mod.questions} r={r} onClose={() => setNavOpen(false)} />
      ) : null}
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
  onToggleHidden,
  onTogglePause,
}: {
  secondsLeft: number;
  hidden: boolean;
  warning: boolean;
  paused: boolean;
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
        <button type="button" onClick={onTogglePause} className={PILL}>
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {paused ? "Resume" : "Pause"}
        </button>
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
  onSaveExit: () => void;
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
        <div className="my-1 h-px bg-slate-100" />
        <button className={item} onClick={() => { onClose(); onSaveExit(); }}>
          <LogOut className="h-[18px] w-[18px] text-slate-500" /> Save &amp; Exit
        </button>
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
}: {
  title: string;
  questions: ExamQuestion[];
  r: RunnerState;
  onClose: () => void;
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
            onClick={onClose}
            className="rounded-full border-2 border-[#2b47c9] px-6 py-2 text-sm font-bold text-[#2b47c9] transition-colors hover:bg-blue-50"
          >
            Go to Review Page
          </button>
        </div>
      </div>
    </div>
  );
}
