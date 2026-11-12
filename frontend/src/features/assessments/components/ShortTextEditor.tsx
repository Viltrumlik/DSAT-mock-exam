"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { FIELD_LABEL, SERIF_AREA } from "@/features/questionsAdmin/questionLook";
import {
  parseJson,
  type AssessmentQuestionEditorDraft,
} from "@/features/assessments/components/assessmentQuestionEditorShared";

// ─── Short text ───────────────────────────────────────────────────────────────

export function ShortTextEditor({
  draft,
  onPatch,
  disabled,
  trackFocus,
}: {
  draft: AssessmentQuestionEditorDraft;
  onPatch: (p: Partial<AssessmentQuestionEditorDraft>) => void;
  disabled?: boolean;
  trackFocus: (
    setVal: (v: string) => void,
  ) => (e: React.FocusEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={`${id}-answer`} className={FIELD_LABEL}>
        Expected answer (exact match)
      </label>
      <textarea
        id={`${id}-answer`}
        className={cn(SERIF_AREA, "min-h-[80px]")}
        disabled={disabled}
        placeholder="Enter the exact expected answer."
        value={(() => {
          const ca = parseJson<unknown>(draft.correctAnswerText, "");
          if (typeof ca === "string") return ca;
          if (Array.isArray(ca) && ca.every((x) => typeof x === "string"))
            return (ca as string[]).join(", ");
          return ca == null ? "" : JSON.stringify(ca);
        })()}
        onChange={(e) => onPatch({ correctAnswerText: JSON.stringify(e.target.value) })}
        onFocus={trackFocus((v) => onPatch({ correctAnswerText: JSON.stringify(v) }))}
      />
    </div>
  );
}
