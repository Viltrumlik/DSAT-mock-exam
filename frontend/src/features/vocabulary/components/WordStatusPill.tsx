import { Badge, type BadgeVariant } from "@/components/ui";

import { WORD_STATUS_LABEL, type WordStatus } from "../types";

/** "New" stays neutral on purpose — an unstudied word is not a failure. */
export const WORD_STATUS_VARIANT: Record<WordStatus, BadgeVariant> = {
  new: "neutral",
  learning: "warning",
  mastered: "success",
};

export function WordStatusPill({ status }: { status: WordStatus }) {
  return (
    <Badge variant={WORD_STATUS_VARIANT[status]} dot>
      {WORD_STATUS_LABEL[status]}
    </Badge>
  );
}
