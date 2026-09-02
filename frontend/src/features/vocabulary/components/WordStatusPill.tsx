import { CheckCircle2, Circle, type LucideIcon } from "lucide-react";

import { Pill, type PillTone } from "@/features/classroom/ui";

import { WORD_STATUS_LABEL, type WordStatus } from "../types";

/** "New" stays neutral on purpose — a word not yet proven in all four games is not a failure. */
export const WORD_STATUS_VARIANT: Record<WordStatus, PillTone> = {
  new: "neutral",
  mastered: "success",
};

/**
 * A glyph reads faster than a dot down a long word list: hollow ring = not proven yet,
 * tick = right in all four games.
 */
const WORD_STATUS_ICON: Record<WordStatus, LucideIcon> = {
  new: Circle,
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
