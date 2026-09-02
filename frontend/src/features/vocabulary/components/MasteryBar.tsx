import { cn } from "@/lib/cn";

import { STUDY_MODES, STUDY_MODE_LABEL, type SectionMastery, type SetMastery } from "../types";

const EMPTY: SetMastery = {
  modes: { flashcard: false, matching: false, speed: false, test: false },
  mastered_modes: 0,
  total_modes: STUDY_MODES.length,
  percent: 0,
  is_mastered: false,
};

/** How full a set's bar is — whole games only, so 0 / 25 / 50 / 75 / 100. */
export function masteryPercent(mastery?: SetMastery | null): number {
  return mastery?.percent ?? 0;
}

/**
 * A set's progress bar: **one segment per game**, filled when that game has been played
 * clean. Four separated segments rather than one sliding fill, because the rule itself is
 * discrete — a quarter appears the moment a game is mastered and never moves between
 * those five positions, and a continuous bar would promise partial credit that does not
 * exist. The gaps are what make "three of four" legible at a glance.
 */
export function MasteryBar({
  mastery,
  legend,
  className,
}: {
  mastery?: SetMastery | null;
  /** Name the games under the bar. Off on a dense card, on where there is room. */
  legend?: boolean;
  className?: string;
}) {
  const m = mastery ?? EMPTY;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className="flex h-2.5 w-full gap-1"
        role="img"
        aria-label={`${m.mastered_modes} of ${m.total_modes} games mastered`}
      >
        {STUDY_MODES.map((mode, i) => (
          <span
            key={mode}
            className={cn(
              "cr-bar h-full flex-1 rounded-full transition-colors duration-500 ease-out",
              m.modes?.[mode] ? "bg-success" : "bg-surface-3",
            )}
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
      {legend ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold text-muted-foreground">
          {STUDY_MODES.map((mode) => (
            <span key={mode} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  m.modes?.[mode] ? "bg-success" : "bg-border-strong",
                )}
              />
              {STUDY_MODE_LABEL[mode]}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A section's bar. One scale up and therefore continuous: a section is "how many of my
 * sets are finished", which moves a set at a time and has no fixed number of steps.
 */
export function SectionMasteryBar({
  mastery,
  className,
}: {
  mastery?: SectionMastery | null;
  className?: string;
}) {
  const done = mastery?.mastered_sets ?? 0;
  const total = mastery?.total_sets ?? 0;
  const pct = mastery?.percent ?? 0;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="img"
        aria-label={`${done} of ${total} sets mastered`}
      >
        <div className="cr-bar h-full rounded-full bg-success transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[12px] font-semibold text-muted-foreground">
        <span className="ds-num font-bold text-foreground">{done}</span> of{" "}
        <span className="ds-num">{total}</span> {total === 1 ? "set" : "sets"} mastered
      </div>
    </div>
  );
}
