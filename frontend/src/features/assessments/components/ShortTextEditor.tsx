"use client";

import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";
import {
  parseJson,
  type AssessmentQuestionEditorDraft,
} from "@/features/assessments/components/assessmentQuestionEditorShared";

const INPUT = STUDIO_INPUT;
const LABEL = STUDIO_FIELD_LABEL;

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
  return (
    <div>
      <label className={LABEL}>Expected answer (exact match)</label>
      <textarea
        className={`${INPUT} min-h-[80px] leading-relaxed`}
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
