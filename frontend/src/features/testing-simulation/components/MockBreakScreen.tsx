"use client";

import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";

/**
 * Between-sections break for a full mock. The remaining time is server-authoritative
 * (``break_remaining_seconds`` from the attempt); this counts down locally from it, and on
 * reach-zero (or "Start Math now") calls ``onEnd`` which advances the attempt to Math.
 */
export function MockBreakScreen({ initialSeconds, onEnd }: { initialSeconds: number; onEnd: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.floor(initialSeconds)));
  const endedRef = useRef(false);

  const end = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    onEnd();
  };

  useEffect(() => {
    if (left <= 0) {
      end();
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const mm = Math.floor(left / 60);
  const ss = left % 60;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center px-6">
      <Timer className="mb-6 h-16 w-16 text-amber-400" />
      <h1 className="mb-2 text-3xl font-black tracking-tight">Scheduled break</h1>
      <p className="mb-10 max-w-md text-center font-medium text-slate-400">
        Reading &amp; Writing is complete. Take your 10-minute break before Math — it opens automatically when the
        timer ends.
      </p>
      <div className="text-6xl font-mono font-black tabular-nums text-amber-300">
        {mm}:{ss.toString().padStart(2, "0")}
      </div>
      <button
        onClick={end}
        className="mt-10 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-slate-900 transition hover:opacity-90"
      >
        Start Math now
      </button>
      <p className="mt-8 text-xs font-bold uppercase tracking-widest text-slate-500">Pause is not available during the mock</p>
    </div>
  );
}
