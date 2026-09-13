import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui";
import { cn } from "@/lib/cn";

import { withLaunchAssignment } from "../launchContext";
// The four games' colours and routes live in `modeTone`, not here: the set progress bar
// paints its segments from the same table, and a component file it had to import a Card
// and a Link to reach was the wrong home for it. Re-exported so the name still resolves
// wherever the mode files' comments point at it.
import {
  MODE_ACCENT,
  MODE_META,
  STUDY_MODE_ACCENT,
  STUDY_MODE_SEGMENT,
  type ModeAccentClasses,
  type StudyModeAccent,
} from "../modeTone";
import { STUDY_MODE_LABEL, type StudyMode } from "../types";

export { STUDY_MODE_ACCENT, STUDY_MODE_SEGMENT };
export type { StudyModeAccent };


/**
 * The per-game score, always shown as **0/1 or 1/1** — never a percentage. A game is
 * pass/fail: it is mastered by one clean run and nothing in between counts, so a fraction
 * with any other denominator would promise partial credit that does not exist. Reading the
 * four cards left to right gives the same number the progress bar above them shows.
 */
function MasteryScore({ mastered, tone }: { mastered: boolean; tone: ModeAccentClasses }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-extrabold",
        // Unearned reads in the game's own tint, not the kit grey: a card whose only
        // filled pixel is a grey badge is the "austere" the owner named.
        mastered ? "bg-success-soft text-success-foreground" : cn(tone.track, tone.cta),
      )}
      title={mastered ? "Mastered — one clean run" : "Not mastered yet"}
    >
      {mastered ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : null}
      <span className="ds-num">{mastered ? "1/1" : "0/1"}</span>
    </span>
  );
}

export function StudyModeCard({
  mode,
  setId,
  disabled,
  accent,
  assignmentId,
  mastered = false,
}: {
  mode: StudyMode;
  setId: number;
  disabled?: boolean;
  /** Override the mode's own accent. Defaults to the per-mode accent above. */
  accent?: StudyModeAccent;
  /** Has this game been played clean for this set? Renders the 0/1 badge. */
  mastered?: boolean;
  /**
   * The homework this launcher was reached from, handed on to the mode so the
   * study session it opens is bound to that assignment instead of the server's
   * guess. Absent for the question bank and the student's own sets — that is
   * self-study, which belongs to no homework.
   */
  assignmentId?: number;
}) {
  const meta = MODE_META[mode];
  const tone = MODE_ACCENT[accent ?? STUDY_MODE_ACCENT[mode]];
  const Icon = meta.icon;

  const body = (
    <Card
      variant={disabled ? "outlined" : "default"}
      className={cn(
        "group relative h-full overflow-hidden",
        disabled ? "opacity-60" : cn("cr-lift", tone.border),
        mastered && "ring-1 ring-inset ring-success/40",
      )}
    >
      {/* Accent edge — the only thing that tells the four cards apart at a glance. */}
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", tone.edge)} />
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl transition-transform duration-200 ease-[var(--ds-ease-premium)] group-hover:-rotate-3 group-hover:scale-105",
              tone.icon,
            )}
          >
            <Icon className="h-[22px] w-[22px]" />
          </span>
          <MasteryScore mastered={mastered} tone={tone} />
        </div>
        <div className="flex-1">
          <h3 className="ds-h4">{STUDY_MODE_LABEL[mode]}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{meta.blurb}</p>
        </div>
        {disabled ? null : (
          <span aria-hidden className={cn("inline-flex items-center gap-1 text-[13px] font-bold", tone.cta)}>
            {mastered ? "Play again" : "Start"}
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </span>
        )}
      </CardContent>
    </Card>
  );

  if (disabled) return body;

  return (
    <Link
      href={withLaunchAssignment(`/vocabulary/sets/${setId}/${STUDY_MODE_SEGMENT[mode]}`, assignmentId)}
      className="ds-ring block h-full rounded-2xl"
    >
      {body}
    </Link>
  );
}
