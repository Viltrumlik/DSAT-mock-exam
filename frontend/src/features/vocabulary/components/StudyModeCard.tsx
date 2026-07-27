import Link from "next/link";
import { ArrowRight, Layers, Shuffle, Timer, ClipboardCheck, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui";
import { cn } from "@/lib/cn";

import { STUDY_MODE_LABEL, type StudyMode } from "../types";

/** URL segment per mode — the route is `/vocabulary/sets/<id>/<segment>`. */
export const STUDY_MODE_SEGMENT: Record<StudyMode, string> = {
  flashcard: "flashcards",
  matching: "matching",
  speed: "speed",
  test: "test",
};

/**
 * The four modes are a *choice*, so each one carries its own semantic accent —
 * four identical grey cards make the pick feel arbitrary. Tokens only, so the
 * accents survive the light/dark toggle.
 */
export type StudyModeAccent = "primary" | "info" | "warning" | "success";

/**
 * Single source of truth for which accent belongs to which mode. Each mode's
 * own full-screen surface mirrors the accent its launcher card carries here —
 * every mode file repeats this pairing in a header comment, so a change made
 * here has exactly four places to follow it.
 */
export const STUDY_MODE_ACCENT: Record<StudyMode, StudyModeAccent> = {
  flashcard: "primary",
  matching: "info",
  speed: "warning",
  test: "success",
};

const ACCENT: Record<StudyModeAccent, { icon: string; edge: string; border: string; cta: string }> = {
  primary: {
    icon: "bg-primary-soft text-primary",
    edge: "from-primary/70 via-primary/25 to-transparent",
    border: "hover:border-primary/40",
    cta: "text-primary",
  },
  info: {
    icon: "bg-info-soft text-info-foreground",
    edge: "from-info/70 via-info/25 to-transparent",
    border: "hover:border-info/40",
    cta: "text-info-foreground",
  },
  warning: {
    icon: "bg-warning-soft text-warning-foreground",
    edge: "from-warning/70 via-warning/25 to-transparent",
    border: "hover:border-warning/40",
    cta: "text-warning-foreground",
  },
  success: {
    icon: "bg-success-soft text-success-foreground",
    edge: "from-success/70 via-success/25 to-transparent",
    border: "hover:border-success/40",
    cta: "text-success-foreground",
  },
};

const MODE_META: Record<StudyMode, { icon: LucideIcon; blurb: string }> = {
  flashcard: {
    icon: Layers,
    blurb: "Flip each card and mark what you knew. Missed words come back.",
  },
  matching: {
    icon: Shuffle,
    blurb: "Pair every word with its definition. The clock runs the whole way.",
  },
  speed: {
    icon: Timer,
    blurb: "Sixty seconds. Pick the right meaning as fast as you can.",
  },
  test: {
    icon: ClipboardCheck,
    blurb: "Multiple choice, true/false and spelling — every word, once.",
  },
};

export function StudyModeCard({
  mode,
  setId,
  disabled,
  accent,
}: {
  mode: StudyMode;
  setId: number;
  disabled?: boolean;
  /** Override the mode's own accent. Defaults to the per-mode colour above. */
  accent?: StudyModeAccent;
}) {
  const meta = MODE_META[mode];
  const tone = ACCENT[accent ?? STUDY_MODE_ACCENT[mode]];
  const Icon = meta.icon;

  const body = (
    <Card
      variant={disabled ? "outlined" : "default"}
      className={cn("group relative h-full overflow-hidden", disabled ? "opacity-60" : cn("cr-lift", tone.border))}
    >
      {/* Accent edge — the only thing that tells the four cards apart at a glance. */}
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", tone.edge)} />
      <CardContent className="flex h-full flex-col gap-3">
        <span
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-2xl transition-transform duration-200 ease-[var(--ds-ease-premium)] group-hover:-rotate-3 group-hover:scale-105",
            tone.icon,
          )}
        >
          <Icon className="h-[22px] w-[22px]" />
        </span>
        <div className="flex-1">
          <h3 className="ds-h4">{STUDY_MODE_LABEL[mode]}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{meta.blurb}</p>
        </div>
        {disabled ? null : (
          <span aria-hidden className={cn("inline-flex items-center gap-1 text-[13px] font-bold", tone.cta)}>
            Start
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </span>
        )}
      </CardContent>
    </Card>
  );

  if (disabled) return body;

  return (
    <Link href={`/vocabulary/sets/${setId}/${STUDY_MODE_SEGMENT[mode]}`} className="ds-ring block h-full rounded-2xl">
      {body}
    </Link>
  );
}
