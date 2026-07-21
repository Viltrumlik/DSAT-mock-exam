/**
 * Pure geometry for the mistakes-per-skill column chart. Split out of the component so the
 * scale, tick and path maths can be asserted without mounting a DOM.
 */

export const PLOT_HEIGHT = 220;
/** Headroom for the value label sitting on the column cap. */
export const PAD_TOP = 26;
/** Room for the y tick numbers, measured from wherever the plot starts. */
export const AXIS_GUTTER = 40;
export const PAD_RIGHT = 20;
/** Room under the baseline for the -38° skill names. */
export const LABEL_BAND = 118;
export const SLOT_WIDTH = 58;
export const MAX_BAR_WIDTH = 24;
export const BAR_RADIUS = 4;
export const LABEL_ANGLE = -38;
export const MAX_LABEL_CHARS = 24;
/** Rough advance width of the 11px semibold label face; only used to reserve space. */
export const LABEL_CHAR_WIDTH = 6;

/**
 * An end-anchored label tilted up to the right hangs down-LEFT of its column, so the
 * leftmost columns would be cut off by the plot edge. This is how much blank space the
 * chart has to reserve left of the axis for them to land in.
 */
export function leftOverhang(labels: string[]): number {
  const reachPerChar = LABEL_CHAR_WIDTH * Math.cos((Math.abs(LABEL_ANGLE) * Math.PI) / 180);
  let need = 0;
  labels.forEach((label, i) => {
    need = Math.max(need, label.length * reachPerChar - (i * SLOT_WIDTH + SLOT_WIDTH / 2));
  });
  return Math.ceil(Math.max(0, need));
}

/**
 * Integer-only ticks: mistakes are counts, so a "2.5 wrong" gridline would be a lie.
 */
export function niceTicks(max: number): { top: number; ticks: number[] } {
  const safeMax = Math.max(1, Math.ceil(max));
  const step =
    safeMax <= 4 ? 1 : safeMax <= 10 ? 2 : safeMax <= 25 ? 5 : Math.ceil(safeMax / 50) * 10;
  const top = Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

/** Rounded cap, square base — the base sits on the axis so it must stay a hard corner. */
export function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.max(0, Math.min(BAR_RADIUS, w / 2, h));
  const bottom = y + h;
  return [
    `M${x},${bottom}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + w - r},${y}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `L${x + w},${bottom}`,
    "Z",
  ].join(" ");
}

export function truncateLabel(name: string, max: number = MAX_LABEL_CHARS): string {
  return name.length <= max ? name : `${name.slice(0, max - 1).trimEnd()}…`;
}

export function accuracyPercent(total: number, wrong: number): number {
  if (total <= 0) return 0;
  return Math.round(((total - wrong) / total) * 100);
}
