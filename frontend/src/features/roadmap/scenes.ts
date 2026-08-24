/**
 * Roadmap scene art and the geometry that lays a level's lessons onto it.
 *
 * Ported from the approved mockup (`mastersat-roadmap-v9.html`). The numbers are not
 * arbitrary and should not be "tidied": each scene is a hand-painted illustration with a road
 * drawn into it, and `cx` / `amp` / `y0` / `y1` are where that painted road actually runs. Change
 * one and the steps stop following the picture.
 *
 * The core problem this solves: **one picture, any number of lessons.** A level may hold 12
 * lessons or 36, and both have to sit on the same illustration without the steps either
 * overlapping or drifting into a sparse line. So the picture is stretched (never more than
 * 1.8×) and the circles are sized from the resulting gap, rather than the layout assuming a
 * fixed lesson count.
 */

export type SceneKey =
  | "math-foundation"
  | "math-junior"
  | "math-middle"
  | "math-senior"
  | "eng-junior"
  | "eng-middle"
  | "eng-senior";

export interface Scene {
  /** Natural pixel size of the artwork, used only as a ratio. */
  w: number;
  h: number;
  /** Centre of the painted road, as a % of the image width. */
  cx: number;
  /** Widest the zig-zag may swing either side of `cx`, % of width. */
  amp: number;
  /** First and last step, as a % of the image height. */
  y0: number;
  y1: number;
  /** The sky colour at the top of the art — fills the stage before the image decodes, so a
   *  slow connection shows the right hue rather than a grey slab. */
  sky: string;
}

const SCENES: Record<SceneKey, Scene> = {
  "math-foundation": { w: 760, h: 2705, cx: 50, amp: 18, y0: 5, y1: 95, sky: "#BAECEB" },
  "math-junior":     { w: 760, h: 3238, cx: 45, amp: 16, y0: 4, y1: 96, sky: "#D1E7E3" },
  "math-middle":     { w: 760, h: 3206, cx: 47, amp: 17, y0: 4, y1: 96, sky: "#F7B69C" },
  "math-senior":     { w: 760, h: 3001, cx: 50, amp: 17, y0: 5, y1: 95, sky: "#ABD3F4" },
  "eng-junior":      { w: 760, h: 2060, cx: 46, amp: 16, y0: 5, y1: 96, sky: "#A4D7F5" },
  "eng-middle":      { w: 760, h: 2012, cx: 42, amp: 16, y0: 5, y1: 95, sky: "#A6D4F6" },
  "eng-senior":      { w: 760, h: 2053, cx: 48, amp: 16, y0: 5, y1: 95, sky: "#AFDEFA" },
};

/** Anything unrecognised gets a plain portrait stage rather than a broken one. */
const FALLBACK: Scene = { w: 3, h: 4, cx: 50, amp: 16, y0: 6, y1: 94, sky: "#EEF3F8" };

/**
 * Which illustration a level uses. `english` maps to the `eng-` prefix, and English has no
 * Foundation course at all — the server never sends that rung for it, so the pairing below
 * cannot produce an `eng-foundation` that does not exist.
 */
export function sceneKeyFor(subject: string, level: string): SceneKey | null {
  const prefix = subject === "math" ? "math" : "eng";
  const key = `${prefix}-${String(level).toLowerCase()}` as SceneKey;
  return key in SCENES ? key : null;
}

export function getScene(key: SceneKey | null): Scene {
  return (key && SCENES[key]) || FALLBACK;
}

export function sceneUrl(key: SceneKey | null): string | null {
  return key ? `/images/roadmap/${key}.png` : null;
}

/** Minimum comfortable gap between two steps, as a % of the stage width. */
const MIN_GAP = 10.6;

/**
 * How much the picture is stretched vertically so `n` lessons can breathe on it.
 *
 * Capped at 1.8×: past that the painted scene visibly smears, and a distorted hillside is
 * worse than steps that sit a little close together.
 */
export function stretch(key: SceneKey | null, n: number): number {
  const s = getScene(key);
  if (n < 2) return 1;
  const natural = s.h / s.w;
  const needed = (MIN_GAP / 100) * (n - 1) / ((s.y1 - s.y0) / 100);
  return Math.max(1, Math.min(1.8, needed / natural));
}

/** Vertical distance between two steps, as a % of the stage WIDTH (not height). */
export function stepGap(key: SceneKey | null, n: number): number {
  const s = getScene(key);
  if (n < 2) return 100;
  return ((s.h / s.w) * stretch(key, n) * ((s.y1 - s.y0) / 100)) / (n - 1) * 100;
}

/** The tighter the steps, the narrower the zig-zag — that is what keeps the angle natural. */
export function ampFor(key: SceneKey | null, n: number): number {
  const s = getScene(key);
  return Math.min(s.amp, Math.max(6, 1.25 * stepGap(key, n)));
}

/** Circle diameter in px for a given rendered stage width. */
export function nodeSize(key: SceneKey | null, n: number, stageWidthPx: number): number {
  const gapPx = (stepGap(key, n) / 100) * stageWidthPx;
  return Math.max(46, Math.min(94, Math.round(gapPx * 0.82)));
}

/** Zig-zag rhythm: centre → right → centre → left → … */
const WAVE = [0, 1, 0, -1];

/** Step positions as `[x%, y%]` of the stage. */
export function layoutPoints(key: SceneKey | null, n: number): [number, number][] {
  const s = getScene(key);
  if (n < 1) return [];
  if (n === 1) return [[s.cx, (s.y0 + s.y1) / 2]];
  const amp = ampFor(key, n);
  return Array.from({ length: n }, (_, i) => [
    s.cx + amp * WAVE[i % WAVE.length],
    s.y0 + ((s.y1 - s.y0) * i) / (n - 1),
  ]);
}
