/**
 * The teacher kit speaks in five tones, each a pair of `--dz-*` tokens: ink for the figure or
 * label, wash for what sits behind it. Components never name a colour themselves — a tone is
 * the only colour decision a caller makes, which is what keeps twenty pages looking like one.
 */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const TONE_INK: Record<Tone, string> = {
  neutral: "var(--dz-mute)",
  info: "var(--dz-indigo)",
  success: "var(--dz-success)",
  warning: "var(--dz-amber)",
  danger: "var(--dz-danger)",
};

export const TONE_WASH: Record<Tone, string> = {
  neutral: "var(--dz-neutral-soft)",
  info: "var(--dz-indigo-soft)",
  success: "var(--dz-success-soft)",
  warning: "var(--dz-amber-soft)",
  danger: "var(--dz-danger-soft)",
};

/** The dashboard card: 24px corners, hairline border, the house card surface. */
export const CARD_SURFACE = {
  background: "var(--dz-card)",
  border: "1px solid var(--dz-border)",
  borderRadius: 24,
} as const;
