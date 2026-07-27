import { cn } from "@/lib/cn";

import type { ProgressCounts } from "../types";

const EMPTY: ProgressCounts = { new: 0, learning: 0, mastered: 0, total: 0 };

/** Share of the words this student has mastered — what the ring and the "N%" copy show. */
export function masteredPercent(progress?: ProgressCounts | null): number {
  const total = progress?.total ?? 0;
  if (!total) return 0;
  return Math.round((progress!.mastered / total) * 100);
}

/**
 * New / Learning / Mastered breakdown as one bar. The track *is* the "new"
 * segment, so an untouched set reads as an empty progress bar rather than as a
 * third colour competing for attention.
 */
export function MasteryBar({
  progress,
  legend,
  className,
}: {
  progress?: ProgressCounts | null;
  /** Show the per-status counts under the bar. */
  legend?: boolean;
  className?: string;
}) {
  const p = progress ?? EMPTY;
  const total = p.total || 0;
  const share = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-3"
        role="img"
        aria-label={`${p.mastered} mastered, ${p.learning} learning, ${p.new} new`}
      >
        <div
          className="h-full bg-success transition-[width] duration-500 ease-out"
          style={{ width: `${share(p.mastered)}%` }}
        />
        <div
          className="h-full bg-warning transition-[width] duration-500 ease-out"
          style={{ width: `${share(p.learning)}%` }}
        />
      </div>
      {legend ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-muted-foreground">
          <LegendDot dotClass="bg-success" label="Mastered" value={p.mastered} />
          <LegendDot dotClass="bg-warning" label="Learning" value={p.learning} />
          <LegendDot dotClass="bg-border-strong" label="New" value={p.new} />
        </div>
      ) : null}
    </div>
  );
}

function LegendDot({ dotClass, label, value }: { dotClass: string; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", dotClass)} />
      {label}
      <span className="ds-num font-bold text-foreground">{value}</span>
    </span>
  );
}
