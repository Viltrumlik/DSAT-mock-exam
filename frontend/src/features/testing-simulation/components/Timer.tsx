"use client";
import { Clock, Eye, EyeOff, Pause, Play } from "lucide-react";
import { formatClock } from "../utils/time";

interface TimerProps {
  secondsLeft: number;
  hidden: boolean;
  onToggleHidden: () => void;
  /** Visually warn under five minutes. */
  warning?: boolean;
  /** Pause control sits beside Hide, same pill style (pastpapers only). */
  pauseAllowed?: boolean;
  paused?: boolean;
  onTogglePause?: () => void;
}

/** Shared pill used for both Hide and Pause so they match exactly. */
const PILL =
  "inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-0.5 text-xs font-semibold text-slate-600 hover:border-slate-400";

/** Bluebook-style countdown with matching Hide / Pause pill controls. Display only — never authoritative. */
export function Timer({ secondsLeft, hidden, onToggleHidden, warning, pauseAllowed, paused, onTogglePause }: TimerProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      {hidden ? (
        // Hidden state shows an unmistakable clock icon so the student knows the
        // timer is minimized, not gone. Under five minutes it turns red even while
        // hidden — hiding the countdown must not hide the fact that it's nearly up.
        <Clock className={`h-7 w-7 ${warning ? "text-red-600" : "text-slate-500"}`} aria-hidden />
      ) : (
        <div
          className={`text-[26px] font-bold leading-none tabular-nums tracking-[0.02em] ${warning ? "text-red-600" : "text-slate-900"}`}
          aria-live="off"
        >
          {formatClock(secondsLeft)}
        </div>
      )}

      {warning && (
        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-700">
          Less than 5 minutes
        </span>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={onToggleHidden} className={PILL}>
          {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {hidden ? "Show" : "Hide"}
        </button>
        {pauseAllowed && onTogglePause && (
          <button type="button" onClick={onTogglePause} aria-pressed={paused} className={PILL}>
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? "Resume" : "Pause"}
          </button>
        )}
      </div>
    </div>
  );
}
