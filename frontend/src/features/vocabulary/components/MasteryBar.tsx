import { cn } from "@/lib/cn";

import { modeAccent } from "../modeTone";
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
 *
 * Each segment wears **its own game's colour** (see `modeTone`), not one shared green.
 * The bar used to say only *how many* games were left; in four colours it also says
 * *which*, and the reader already knows them — they are the colours of the four launcher
 * cards on the set page and of the guide on the hub. An unplayed segment is a tint of
 * that same hue rather than grey, so a set at 0% still has colour in it.
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
        {STUDY_MODES.map((mode, i) => {
          const tone = modeAccent(mode);
          const done = Boolean(m.modes?.[mode]);
          return (
            <span
              key={mode}
              title={`${STUDY_MODE_LABEL[mode]} — ${done ? "mastered" : "not yet"}`}
              className={cn(
                "ds-growx h-full flex-1 rounded-full transition-colors duration-500 ease-out",
                done ? tone.fill : tone.track,
              )}
              style={{ "--ds-delay": `${i * 90}ms` } as React.CSSProperties}
            />
          );
        })}
      </div>
      {legend ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-semibold">
          {STUDY_MODES.map((mode) => {
            const tone = modeAccent(mode);
            const done = Boolean(m.modes?.[mode]);
            return (
              <span
                key={mode}
                className={cn("inline-flex items-center gap-1.5", done ? tone.cta : "text-muted-foreground")}
              >
                <span className={cn("h-2 w-2 rounded-full", done ? tone.dot : tone.track)} />
                {STUDY_MODE_LABEL[mode]}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A section's bar. One scale up and therefore continuous: a section is "how many of my
 * sets are finished", which moves a set at a time and has no fixed number of steps.
 *
 * `bar` and `track` let the section paint it in its own colour — the same hue as its icon
 * and its ring, so the card reads as one object. Left out, it falls back to the success
 * green on a tint of itself.
 */
export function SectionMasteryBar({
  mastery,
  className,
  bar,
  track,
}: {
  mastery?: SectionMastery | null;
  className?: string;
  /** Fill colour class. Defaults to the success green. */
  bar?: string;
  /** Unfilled colour class. A tint — never `bg-surface-3`, which is the grey. */
  track?: string;
}) {
  const done = mastery?.mastered_sets ?? 0;
  const total = mastery?.total_sets ?? 0;
  const pct = mastery?.percent ?? 0;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className={cn("h-2.5 w-full overflow-hidden rounded-full", track ?? "bg-success/15")}
        role="img"
        aria-label={`${done} of ${total} sets mastered`}
      >
        <div
          className={cn("cr-bar h-full rounded-full transition-[width] duration-500 ease-out", bar ?? "bg-success")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[12px] font-semibold text-muted-foreground">
        <span className="ds-num font-bold text-foreground">{done}</span> of{" "}
        <span className="ds-num">{total}</span> {total === 1 ? "set" : "sets"} mastered
      </div>
    </div>
  );
}
