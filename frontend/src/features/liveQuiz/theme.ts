/**
 * The game's look in data: answer-tile colours, power-up names, and the per-student option
 * order. Kept apart from the components so a test can check the shuffle without rendering.
 */

import type { LiveChoice, PowerUpKey } from "./api";

/**
 * One colour per option position — the tile, not the letter, is what a student finds with
 * their thumb. Five, because a question can have up to five options. Each has enough contrast
 * with white text to read at arm's length on a phone in a bright classroom.
 */
export const TILE_COLORS = ["#2563eb", "#0f9488", "#d97706", "#db2763", "#7c3aed"] as const;

export function tileColor(position: number): string {
  return TILE_COLORS[position % TILE_COLORS.length];
}

export interface PowerUpMeta {
  label: string;
  /** One line for the button's tooltip and the "you earned" toast. */
  help: string;
  /** Short mark drawn on the button. */
  glyph: string;
  color: string;
}

export const POWERUPS: Record<PowerUpKey, PowerUpMeta> = {
  double: { label: "Double", help: "A right answer on this question scores twice.", glyph: "2×", color: "#f59e0b" },
  fifty_fifty: { label: "50-50", help: "Two wrong options disappear.", glyph: "½", color: "#22c55e" },
  eraser: { label: "Eraser", help: "One wrong option disappears.", glyph: "⌫", color: "#38bdf8" },
  streak_saver: { label: "Streak saver", help: "A wrong answer here will not break your streak.", glyph: "🛡", color: "#a78bfa" },
  time_freeze: { label: "Time freeze", help: "The clock stops for this question.", glyph: "❄", color: "#67e8f9" },
};

/** A small, fast, seedable generator — the same seed always deals the same order. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The options in this student's own order.
 *
 * Seeded by student and question, so a refresh or a second tab shows the same order, and the
 * student beside them sees a different one. Only the DISPLAY moves: every option keeps its id,
 * so grading, tallies and the host's bars never know the order was changed.
 */
export function shuffledChoices(choices: LiveChoice[], seed: number): LiveChoice[] {
  const out = [...choices];
  const next = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function seedFor(participantId: number | null | undefined, questionId: number): number {
  return ((participantId ?? 0) * 7919 + questionId * 104729) >>> 0;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Initials for a name chip in the lobby. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
