"use client";

import { useState } from "react";

/**
 * A number that rolls when it changes (design handoff v0.3, Motion board, "Number rolls"): the old
 * value goes up and out while the new one comes up and in, 240 ms, so the desk sees what changed
 * and not only the result. The first value rolls in as well (skeleton → number). Under reduced
 * motion both animations collapse to their end state: the number simply swaps.
 */
export function RollNumber({ value, className = "" }: { value: string | number; className?: string }) {
  const [s, setS] = useState<{ cur: string | number; prev: string | number | null; n: number }>({ cur: value, prev: null, n: 0 });
  if (s.cur !== value) setS({ cur: value, prev: s.cur, n: s.n + 1 });
  return (
    <span className={`inline-grid overflow-hidden align-bottom ${className}`}>
      {s.prev !== null ? (
        <span key={`out-${s.n}`} aria-hidden="true" className="animate-ms-roll-out [grid-area:1/1]">
          {s.prev}
        </span>
      ) : null}
      <span key={`in-${s.n}`} className="animate-ms-roll-in [grid-area:1/1]">
        {s.cur}
      </span>
    </span>
  );
}
