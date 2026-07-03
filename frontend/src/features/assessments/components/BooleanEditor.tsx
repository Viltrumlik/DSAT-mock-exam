"use client";

import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";
import {
  parseJson,
  type AssessmentQuestionEditorDraft,
} from "@/features/assessments/components/assessmentQuestionEditorShared";

const INPUT = STUDIO_INPUT;
const LABEL = STUDIO_FIELD_LABEL;

// ─── Boolean ──────────────────────────────────────────────────────────────────

export function BooleanEditor({
  draft,
  onPatch,
  disabled,
}: {
  draft: AssessmentQuestionEditorDraft;
  onPatch: (p: Partial<AssessmentQuestionEditorDraft>) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className={LABEL}>Correct answer</label>
      <select
        className={INPUT}
        disabled={disabled}
        value={String(parseJson(draft.correctAnswerText, true))}
        onChange={(e) => onPatch({ correctAnswerText: JSON.stringify(e.target.value === "true") })}
      >
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    </div>
  );
}
