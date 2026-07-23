"use client";
import { Calculator, ChevronDown, Highlighter, StickyNote } from "lucide-react";
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
  /** Reference sheet is SAT Math-only. */
  mathTools: boolean;
  /** Calculator: Math-only; midterms only at middle/senior level (server-decided). */
  showCalculator: boolean;
  tools: ExamTools;
  pauseAllowed: boolean;
  paused: boolean;
  onTogglePause: () => void;
  onSaveAndExit: () => void;
  onReportProblem?: () => void;
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
  showCalculator,
  tools,
  pauseAllowed,
  paused,
  onTogglePause,
  onSaveAndExit,
  onReportProblem,
}: ExamHeaderProps) {
  return (
    <header className="grid shrink-0 grid-cols-3 items-center bg-white px-6 py-3">
      <div className="flex flex-col items-start">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-tight text-slate-900">{moduleTitle}</h1>
        </div>
        <button
          type="button"
          onClick={onToggleDirections}
          aria-expanded={showDirections}
          className="mt-0.5 inline-flex items-center gap-1 text-[15px] text-slate-800 hover:text-slate-950"
        >
          Directions <ChevronDown className={`h-4 w-4 transition-transform ${showDirections ? "rotate-180" : ""}`} />
        </button>
      </div>

      <div className="flex justify-center">
        {/* Pause sits beside Hide as a matching pill (item: Pause Button). */}
        <Timer
          secondsLeft={secondsLeft}
          hidden={timerHidden}
          onToggleHidden={onToggleTimer}
          warning={timerWarning}
          pauseAllowed={pauseAllowed}
          paused={paused}
          onTogglePause={onTogglePause}
        />
      </div>

      <div className="flex items-center justify-end gap-6">
        {showCalculator && (
          <ToolButton label="Calculator" active={tools.calculatorOpen} onClick={tools.toggleCalculator}>
            <Calculator className="h-5 w-5" />
          </ToolButton>
        )}
        {mathTools && (
          <ToolButton label="Reference" active={tools.referenceOpen} onClick={tools.toggleReference}>
            <span className="text-base font-bold italic leading-none">x²</span>
          </ToolButton>
        )}
        {/* Bluebook groups highlighting + notes under one control. It toggles the
            highlighter (select-to-highlight); the notes pad opens from a highlight's
            note button or the More menu. */}
        <ToolButton label="Highlights & Notes" active={tools.highlighterActive} onClick={tools.toggleHighlighter}>
          <span className="flex items-center gap-1.5">
            <Highlighter className="h-[18px] w-[18px]" />
            <StickyNote className="h-[18px] w-[18px]" />
          </span>
        </ToolButton>
        <MoreMenu
          isFullscreen={tools.fullscreen.isFullscreen}
          onToggleFullscreen={tools.fullscreen.toggle}
          highlighterActive={tools.highlighterActive}
          onToggleHighlighter={tools.toggleHighlighter}
          notesOpen={tools.notesOpen}
          onToggleNotes={tools.toggleNotes}
          onReportProblem={onReportProblem}
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
