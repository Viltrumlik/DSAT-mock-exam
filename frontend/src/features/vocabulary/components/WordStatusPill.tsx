import { CheckCircle2, Circle, TrendingUp, type LucideIcon } from "lucide-react";

import { Pill, type PillTone } from "@/features/classroom/ui";

import { WORD_STATUS_LABEL, type WordStatus } from "../types";

/** "New" stays neutral on purpose — an unstudied word is not a failure. */
export const WORD_STATUS_VARIANT: Record<WordStatus, PillTone> = {
  new: "neutral",
  learning: "warning",
  mastered: "success",
};

/**
 * A glyph reads faster than a dot down a long word list: hollow ring = never
 * touched, arrow = climbing, tick = done.
 */
const WORD_STATUS_ICON: Record<WordStatus, LucideIcon> = {
  new: Circle,
  learning: TrendingUp,
  mastered: CheckCircle2,
};

export function WordStatusPill({ status }: { status: WordStatus }) {
  const Icon = WORD_STATUS_ICON[status];
  return (
    <Pill tone={WORD_STATUS_VARIANT[status]}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {WORD_STATUS_LABEL[status]}
    </Pill>
  );
}
