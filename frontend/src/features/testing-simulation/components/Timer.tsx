"use client";
import { Clock, Eye, EyeOff } from "lucide-react";
import { formatClock } from "../utils/time";

interface TimerProps {
  secondsLeft: number;
  hidden: boolean;
  onToggleHidden: () => void;
  /** Visually warn under five minutes. */
  warning?: boolean;
}

/** Bluebook-style countdown with a Hide/Show toggle. Display only — never authoritative. */
export function Timer({ secondsLeft, hidden, onToggleHidden, warning }: TimerProps) {
  // ── Hidden state (item: Hidden State Indicator) ──────────────────────────────
  // When the clock is hidden we replace the digits with an unmistakable clock
  // icon so the student immediately understands the timer is minimized (not
  // gone). Clicking it reveals the countdown again.
  if (hidden) {
    return (
      <button
        type="button"
        onClick={onToggleHidden}
        aria-label="Show timer"
        title="Show timer"
        className="flex flex-col items-center gap-1 text-slate-500 hover:text-slate-800"
      >
        <Clock className="h-7 w-7" aria-hidden />
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-0.5 text-xs font-semibold text-slate-600">
          <Eye className="h-3.5 w-3.5" />
          Show
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`text-2xl font-bold tabular-nums tracking-tight ${warning ? "text-red-600" : "text-slate-900"}`}
        aria-live="off"
      >
        {formatClock(secondsLeft)}
      </div>
      <button
        type="button"
        onClick={onToggleHidden}
        className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-0.5 text-xs font-semibold text-slate-600 hover:border-slate-400"
      >
        <EyeOff className="h-3.5 w-3.5" />
        Hide
      </button>
    </div>
  );
}
