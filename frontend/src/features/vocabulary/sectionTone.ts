import { Compass, Feather, Gem, Landmark, Library, Rocket, type LucideIcon } from "lucide-react";

/**
 * A published section's own colour and glyph.
 *
 * Every section card used to be identical: the same `Library` icon in the same blue
 * square, the same grey bar, the same "Open section". Four of them side by side could be
 * told apart only by reading the titles, which is the slowest way a page can be read —
 * and with every bank section sitting at 0% there was not even a ring to separate them.
 *
 * So a section gets a hue and a glyph of its own and carries them everywhere it appears:
 * the hub card, its own page, the meter underneath it.
 *
 * Keyed on the section **id**, not its position in the list. The detail page has only an
 * id, and a section that keeps its colour when a newer one is published above it stays
 * recognisable. Six of each: a seventh section starts the cycle again, which is a repeat
 * rather than a clash — the title still says which is which, and the bank carries four.
 */

export type VocabTone = "primary" | "violet" | "emerald" | "amber" | "sky" | "rose";

export interface VocabToneClasses {
  /** Tinted square behind the glyph. */
  icon: string;
  /** The card's own wash and border, so the colour is the card and not a corner of it. */
  wash: string;
  /** Top edge — the accent that still reads when the card is scrolled to its title. */
  edge: string;
  /** Accent text: the "Open section" affordance, the count that matters. */
  text: string;
  /** Solid meter fill. */
  bar: string;
  /** The meter's unfilled part — a tint of the same hue, never the grey it was. */
  track: string;
  /** `ProgressRing` takes a text-colour class. */
  ring: string;
  /** The ring's unfilled arc: a tint of the same hue, so a section at 0 is not a grey doughnut. */
  ringTrack: string;
  /** Soft chip on the section's own surface. */
  chip: string;
  /**
   * A gradient wash laid over the card as its own element.
   *
   * NOT a background class on the card itself: `cn()` is a plain joiner, not
   * tailwind-merge, so a `bg-*` of ours and the kit's `bg-card` would both be emitted
   * and the winner would be whichever the stylesheet happens to order last. An overlay
   * has no such argument to lose.
   */
  glow: string;
}

/**
 * `--chart-5` and `--chart-6` have no `-soft` companion the way `primary` and the status
 * colours do, so those two mix their own tints. Every value here is a token, so the
 * palette follows the light/dark toggle without a second table.
 */
const TONE: Record<VocabTone, VocabToneClasses> = {
  primary: {
    icon: "bg-primary/15 text-primary dark:text-primary-hover",
    wash: "border-primary/25 bg-primary-soft",
    edge: "from-primary via-primary/40 to-transparent",
    text: "text-primary dark:text-primary-hover",
    bar: "bg-primary",
    track: "bg-primary/15",
    ring: "text-primary",
    ringTrack: "text-primary/20",
    chip: "bg-primary/10 text-primary dark:text-primary-hover",
    glow: "from-primary/[0.18] via-primary/[0.05] to-transparent",
  },
  violet: {
    icon: "bg-[color-mix(in_oklab,var(--chart-6)_16%,transparent)] text-[var(--chart-6)]",
    wash: "border-[color-mix(in_oklab,var(--chart-6)_26%,transparent)] bg-[color-mix(in_oklab,var(--chart-6)_8%,transparent)]",
    edge: "from-[var(--chart-6)] via-[color-mix(in_oklab,var(--chart-6)_40%,transparent)] to-transparent",
    text: "text-[var(--chart-6)]",
    bar: "bg-[var(--chart-6)]",
    track: "bg-[color-mix(in_oklab,var(--chart-6)_16%,transparent)]",
    ring: "text-[var(--chart-6)]",
    ringTrack: "text-[color-mix(in_oklab,var(--chart-6)_22%,transparent)]",
    chip: "bg-[color-mix(in_oklab,var(--chart-6)_12%,transparent)] text-[var(--chart-6)]",
    glow: "from-[color-mix(in_oklab,var(--chart-6)_14%,transparent)] via-[color-mix(in_oklab,var(--chart-6)_4%,transparent)] to-transparent",
  },
  emerald: {
    icon: "bg-success/15 text-success-foreground",
    wash: "border-success/25 bg-success-soft",
    edge: "from-success via-success/40 to-transparent",
    text: "text-success-foreground",
    bar: "bg-success",
    track: "bg-success/15",
    ring: "text-success",
    ringTrack: "text-success/20",
    chip: "bg-success/10 text-success-foreground",
    glow: "from-success/[0.14] via-success/[0.04] to-transparent",
  },
  amber: {
    icon: "bg-warning/15 text-warning-foreground",
    wash: "border-warning/25 bg-warning-soft",
    edge: "from-warning via-warning/40 to-transparent",
    text: "text-warning-foreground",
    bar: "bg-warning",
    track: "bg-warning/15",
    ring: "text-warning",
    ringTrack: "text-warning/22",
    chip: "bg-warning/10 text-warning-foreground",
    glow: "from-warning/[0.16] via-warning/[0.05] to-transparent",
  },
  sky: {
    icon: "bg-info/15 text-info-foreground",
    wash: "border-info/25 bg-info-soft",
    edge: "from-info via-info/40 to-transparent",
    text: "text-info-foreground",
    bar: "bg-info",
    track: "bg-info/15",
    ring: "text-info",
    ringTrack: "text-info/22",
    chip: "bg-info/10 text-info-foreground",
    glow: "from-info/[0.15] via-info/[0.04] to-transparent",
  },
  rose: {
    icon: "bg-[color-mix(in_oklab,var(--chart-5)_16%,transparent)] text-[var(--chart-5)]",
    wash: "border-[color-mix(in_oklab,var(--chart-5)_26%,transparent)] bg-[color-mix(in_oklab,var(--chart-5)_8%,transparent)]",
    edge: "from-[var(--chart-5)] via-[color-mix(in_oklab,var(--chart-5)_40%,transparent)] to-transparent",
    text: "text-[var(--chart-5)]",
    bar: "bg-[var(--chart-5)]",
    track: "bg-[color-mix(in_oklab,var(--chart-5)_16%,transparent)]",
    ring: "text-[var(--chart-5)]",
    ringTrack: "text-[color-mix(in_oklab,var(--chart-5)_22%,transparent)]",
    chip: "bg-[color-mix(in_oklab,var(--chart-5)_12%,transparent)] text-[var(--chart-5)]",
    glow: "from-[color-mix(in_oklab,var(--chart-5)_14%,transparent)] via-[color-mix(in_oklab,var(--chart-5)_4%,transparent)] to-transparent",
  },
};

/**
 * Ordered so that CONSECUTIVE slots are as far apart in hue as the six get — blue,
 * orange, purple, green, pink, cyan. Sections are published in a run, so their ids are
 * consecutive, and a palette listed by family would hand the two blues to neighbouring
 * cards. With the bank's ids (4, 5, 6, 7) this comes out pink, cyan, blue, orange.
 */
const ORDER: VocabTone[] = ["primary", "amber", "violet", "emerald", "rose", "sky"];

/** One glyph per slot, in the same order, so colour and shape always travel together. */
const ICONS: LucideIcon[] = [Library, Feather, Compass, Rocket, Landmark, Gem];

/** Which of the six slots this section owns. Anything non-numeric falls to the first. */
function slot(sectionId: number): number {
  if (!Number.isFinite(sectionId)) return 0;
  return Math.abs(Math.trunc(sectionId)) % ORDER.length;
}

export function sectionTone(sectionId: number): VocabTone {
  return ORDER[slot(sectionId)];
}

export function sectionIcon(sectionId: number): LucideIcon {
  return ICONS[slot(sectionId)];
}

export function toneClasses(tone: VocabTone): VocabToneClasses {
  return TONE[tone];
}

/** Colour + glyph in one call, which is how every caller needs them. */
export function sectionLook(sectionId: number): VocabToneClasses & { Icon: LucideIcon; tone: VocabTone } {
  const tone = sectionTone(sectionId);
  return { ...TONE[tone], Icon: sectionIcon(sectionId), tone };
}
