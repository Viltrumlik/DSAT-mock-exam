"use client";
import { Calculator, Check, ChevronDown, CloudOff, Flag, Highlighter, Loader2, StickyNote } from "lucide-react";
import { Timer } from "./Timer";
import { MoreMenu } from "../tools/MoreMenu";
import type { ExamTools } from "../tools/useExamTools";
import type { SaveStatus } from "../hooks/useAutosave";

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
  /** Autosave status. Omitted for mocks/midterms → the indicator is hidden. */
  saveStatus?: SaveStatus;
}

/** Small "your answers are saved" indicator (pastpapers). Reassures the student
 * their work persists so they can leave and resume in place. */
function SaveIndicator({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { icon: React.ReactNode; text: string; className: string } | null> = {
    idle: null,
    saving: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, text: "Saving…", className: "text-slate-500" },
    retrying: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, text: "Saving…", className: "text-slate-500" },
    saved: { icon: <Check className="h-3.5 w-3.5" />, text: "Saved", className: "text-emerald-600" },
    offline: { icon: <CloudOff className="h-3.5 w-3.5" />, text: "Saved on this device", className: "text-amber-600" },
    error: { icon: <CloudOff className="h-3.5 w-3.5" />, text: "Retrying…", className: "text-amber-600" },
  };
  const s = map[status];
  if (!s) return null;
  return (
    <span className={`mt-0.5 inline-flex items-center gap-1 text-xs font-semibold ${s.className}`} aria-live="polite">
      {s.icon}
      {s.text}
    </span>
  );
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
  saveStatus,
}: ExamHeaderProps) {
  return (
    <header className="grid shrink-0 grid-cols-3 items-center bg-white px-6 py-3">
      <div className="flex flex-col items-start">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-tight text-slate-900">{moduleTitle}</h1>
          {saveStatus != null && <SaveIndicator status={saveStatus} />}
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

      <div className="flex items-center justify-end gap-5">
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
        <ToolButton label="Highlights" active={tools.highlighterActive} onClick={tools.toggleHighlighter}>
          <Highlighter className="h-5 w-5" />
        </ToolButton>
        {onReportProblem && (
          <ToolButton label="Report" onClick={onReportProblem}>
            <Flag className="h-5 w-5" />
          </ToolButton>
        )}
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
