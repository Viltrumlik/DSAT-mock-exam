"use client";
import { Calculator, ChevronDown, Highlighter, Pause, Play, StickyNote } from "lucide-react";
import { Timer } from "./Timer";
import { MoreMenu } from "../tools/MoreMenu";
import type { ExamTools } from "../tools/useExamTools";

interface ExamHeaderProps {
  moduleTitle: string;
  secondsLeft: number;
  timerHidden: boolean;
  onToggleTimer: () => void;
  timerWarning: boolean;
  showDirections: boolean;
  onToggleDirections: () => void;
  /** Calculator + Reference are SAT Math-only. */
  mathTools: boolean;
  tools: ExamTools;
  pauseAllowed: boolean;
  paused: boolean;
  onTogglePause: () => void;
  onSaveAndExit: () => void;
  /** Autosave / connectivity status — shown beside the module title. */
  saveLabel?: string;
  saveTone?: "muted" | "warn" | "ok";
}

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-center text-xs font-semibold ${active ? "text-blue-700" : "text-slate-600 hover:text-slate-900"}`}
    >
      {children}
      {label}
    </button>
  );
}

/** Top bar: title/Directions, central timer, and the SAT tool cluster. */
export function ExamHeader({
  moduleTitle,
  secondsLeft,
  timerHidden,
  onToggleTimer,
  timerWarning,
  showDirections,
  onToggleDirections,
  mathTools,
  tools,
  pauseAllowed,
  paused,
  onTogglePause,
  onSaveAndExit,
  saveLabel,
  saveTone = "muted",
}: ExamHeaderProps) {
  const saveToneClass = saveTone === "warn" ? "text-amber-600" : saveTone === "ok" ? "text-emerald-600" : "text-slate-400";
  return (
    <header className="grid shrink-0 grid-cols-3 items-center bg-white px-6 py-3">
      <div className="flex flex-col items-start">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-tight text-slate-900">{moduleTitle}</h1>
          {/* Saved / connectivity status moved beside the module title (item:
              Student Identity Footer — "move saved message to left header"). */}
          {saveLabel ? (
            <span className={`text-xs font-semibold ${saveToneClass}`} role="status" aria-live="polite">
              {saveLabel}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onToggleDirections}
          aria-expanded={showDirections}
          className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-slate-700 hover:text-slate-900"
        >
          Directions <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-center gap-4">
        <Timer secondsLeft={secondsLeft} hidden={timerHidden} onToggleHidden={onToggleTimer} warning={timerWarning} />
        {/* Pause button placed next to the timer's Hide toggle (item: Pause Button). */}
        {pauseAllowed && (
          <button
            type="button"
            onClick={onTogglePause}
            aria-pressed={paused}
            className={`flex flex-col items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              paused ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-600 hover:border-slate-400 hover:text-slate-900"
            }`}
          >
            {paused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
            {paused ? "Resume" : "Pause"}
          </button>
        )}
      </div>

      <div className="flex items-center justify-end gap-5">
        {mathTools && (
          <>
            <ToolButton label="Calculator" active={tools.calculatorOpen} onClick={tools.toggleCalculator}>
              <Calculator className="h-5 w-5" />
            </ToolButton>
            <ToolButton label="Reference" active={tools.referenceOpen} onClick={tools.toggleReference}>
              <span className="text-base font-bold italic leading-none">x²</span>
            </ToolButton>
          </>
        )}
        <ToolButton label="Highlights" active={tools.highlighterActive} onClick={tools.toggleHighlighter}>
          <Highlighter className="h-5 w-5" />
        </ToolButton>
        {/* Notes moved out of the More menu into the header (item: Notes in Header). */}
        <ToolButton label="Notes" active={tools.notesOpen} onClick={tools.toggleNotes}>
          <StickyNote className="h-5 w-5" />
        </ToolButton>
        <MoreMenu
          isFullscreen={tools.fullscreen.isFullscreen}
          onToggleFullscreen={tools.fullscreen.toggle}
          highlighterActive={tools.highlighterActive}
          onToggleHighlighter={tools.toggleHighlighter}
          onZoomIn={tools.zoomIn}
          onZoomOut={tools.zoomOut}
          onToggleHelp={tools.toggleHelp}
          pauseAllowed={pauseAllowed}
          paused={paused}
          onTogglePause={onTogglePause}
          onSaveAndExit={onSaveAndExit}
        />
      </div>
    </header>
  );
}
