"use client";
import { Eye, EyeOff } from "lucide-react";
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
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={`text-2xl font-bold tabular-nums tracking-tight ${warning ? "text-red-600" : "text-slate-900"}`}
        aria-live="off"
        aria-hidden={hidden}
      >
        {hidden ? "—:—" : formatClock(secondsLeft)}
      </div>
      <button
        type="button"
        onClick={onToggleHidden}
        className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-0.5 text-xs font-semibold text-slate-600 hover:border-slate-400"
      >
        {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        {hidden ? "Show" : "Hide"}
      </button>
    </div>
  );
}
