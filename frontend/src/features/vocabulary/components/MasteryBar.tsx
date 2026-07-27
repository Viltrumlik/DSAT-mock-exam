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
 * New / Learning / Mastered breakdown as ONE segmented bar: three coloured
 * segments sharing a single track, so a glance reads the whole split rather
 * than just "how far along". An untouched set is all-neutral; a finished one is
 * all-green. Segments after a non-empty neighbour carry a 1px card-coloured
 * inset so the boundary stays legible when two tones sit side by side.
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

  const segments = [
    { key: "mastered", fill: "bg-success", value: p.mastered },
    { key: "learning", fill: "bg-warning", value: p.learning },
    { key: "new", fill: "bg-border-strong", value: p.new },
  ];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="img"
        aria-label={`${p.mastered} mastered, ${p.learning} learning, ${p.new} new`}
      >
        {segments.map((s, i) => (
          <span
            key={s.key}
            className={cn(
              "cr-bar h-full transition-[width] duration-500 ease-out",
              s.fill,
              // Hairline separator only when something actually precedes it.
              i > 0 && segments[i - 1].value > 0 && s.value > 0 && "shadow-[inset_1px_0_0_var(--card)]",
            )}
            style={{ width: `${share(s.value)}%`, animationDelay: `${i * 90}ms` }}
          />
        ))}
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
