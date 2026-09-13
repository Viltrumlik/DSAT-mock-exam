import { ClipboardCheck, Layers, Shuffle, Timer, type LucideIcon } from "lucide-react";

import type { StudyMode } from "./types";

/**
 * The colour each of the four games owns, in one place.
 *
 * It was already implied — every mode's own full-screen surface carries an accent, and
 * each mode file repeats the pairing in a header comment — but it lived inside
 * `components/StudyModeCard`, so nothing else could reach it. The set progress bar
 * therefore painted all four of its segments the same green, which threw away the one
 * thing the bar could have said: *which* game is still owed.
 *
 * Now the pairing is the module, and the bar, the launcher card and the guide on the
 * hub all read it. A colour means the same game everywhere in the feature.
 */

export type StudyModeAccent = "primary" | "info" | "warning" | "success";

export const STUDY_MODE_ACCENT: Record<StudyMode, StudyModeAccent> = {
  flashcard: "primary",
  matching: "info",
  speed: "warning",
  test: "success",
};

/** URL segment per mode — the route is `/vocabulary/sets/<id>/<segment>`. */
export const STUDY_MODE_SEGMENT: Record<StudyMode, string> = {
  flashcard: "flashcards",
  matching: "matching",
  speed: "speed",
  test: "test",
};

export interface ModeAccentClasses {
  /** Tinted square behind the game's glyph. */
  icon: string;
  /** The top edge on a launcher card. */
  edge: string;
  /** Border on hover. */
  border: string;
  /** The "Start" affordance. */
  cta: string;
  /** A mastered segment of the progress bar: the game's colour, at full strength. */
  fill: string;
  /**
   * A segment not yet mastered. A TINT of the same hue rather than the grey it used to
   * be — an empty bar of four greys is the single largest cold patch on the page, and
   * the tint still reads as unfilled next to a solid neighbour.
   */
  track: string;
  /** The legend dot under the bar. */
  dot: string;
  /** The game's own card wash on the hub guide — border + tinted ground. */
  wash: string;
}

export const MODE_ACCENT: Record<StudyModeAccent, ModeAccentClasses> = {
  primary: {
    icon: "bg-primary-soft text-primary",
    edge: "from-primary/70 via-primary/25 to-transparent",
    border: "hover:border-primary/40",
    cta: "text-primary",
    fill: "bg-primary",
    track: "bg-primary/15",
    dot: "bg-primary",
    wash: "border-primary/25 bg-primary-soft",
  },
  info: {
    icon: "bg-info-soft text-info-foreground",
    edge: "from-info/70 via-info/25 to-transparent",
    border: "hover:border-info/40",
    cta: "text-info-foreground",
    fill: "bg-info",
    track: "bg-info/15",
    dot: "bg-info",
    wash: "border-info/25 bg-info-soft",
  },
  warning: {
    icon: "bg-warning-soft text-warning-foreground",
    edge: "from-warning/70 via-warning/25 to-transparent",
    border: "hover:border-warning/40",
    cta: "text-warning-foreground",
    fill: "bg-warning",
    track: "bg-warning/15",
    dot: "bg-warning",
    wash: "border-warning/25 bg-warning-soft",
  },
  success: {
    icon: "bg-success-soft text-success-foreground",
    edge: "from-success/70 via-success/25 to-transparent",
    border: "hover:border-success/40",
    cta: "text-success-foreground",
    fill: "bg-success",
    track: "bg-success/15",
    dot: "bg-success",
    wash: "border-success/25 bg-success-soft",
  },
};

/** The classes for a given game, without going through the accent name. */
export function modeAccent(mode: StudyMode): ModeAccentClasses {
  return MODE_ACCENT[STUDY_MODE_ACCENT[mode]];
}

/**
 * What each game asks of you, in one line. Shared by the launcher card on a set's page
 * and the guide on the hub, so a student is never told two different things about the
 * same game.
 */
export const MODE_META: Record<StudyMode, { icon: LucideIcon; blurb: string }> = {
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
