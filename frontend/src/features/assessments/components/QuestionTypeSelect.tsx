"use client";

import type { AssessmentQuestionType } from "@/features/assessments/types";
import { defaultMcChoices } from "@/features/assessments/components/ChoiceEditor";
import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";
import type { AssessmentQuestionEditorDraft } from "@/features/assessments/components/assessmentQuestionEditorShared";

const INPUT = STUDIO_INPUT;
const LABEL = STUDIO_FIELD_LABEL;

// ─── Question type + points ───────────────────────────────────────────────────

export function QuestionTypeSelect({
  draft,
  onPatch,
  disabled,
}: {
  draft: AssessmentQuestionEditorDraft;
  onPatch: (p: Partial<AssessmentQuestionEditorDraft>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className={LABEL}>Question type</label>
        <select
          className={INPUT}
          disabled={disabled}
          value={draft.question_type}
          onChange={(e) => {
            const t = e.target.value as AssessmentQuestionType;
            const patch: Partial<AssessmentQuestionEditorDraft> = { question_type: t };
            if (t === "multiple_choice") {
              patch.choicesText = JSON.stringify(defaultMcChoices(), null, 2);
              patch.correctAnswerText = JSON.stringify("A");
              patch.gradingConfigText = "{}";
            } else if (t === "numeric") {
              patch.choicesText = "[]";
              patch.correctAnswerText = JSON.stringify(0);
              patch.gradingConfigText = JSON.stringify({ tolerance: 0 }, null, 2);
            } else if (t === "boolean") {
              patch.choicesText = "[]";
              patch.correctAnswerText = JSON.stringify(true);
              patch.gradingConfigText = "{}";
            } else {
              patch.choicesText = "[]";
              patch.correctAnswerText = JSON.stringify("");
              patch.gradingConfigText = "{}";
            }
            onPatch(patch);
          }}
        >
          <option value="multiple_choice">Multiple choice</option>
          <option value="numeric">Numeric</option>
          <option value="short_text">Short text</option>
          <option value="boolean">True / False</option>
        </select>
      </div>
      <div>
        <label className={LABEL}>Points</label>
        <input
          className={INPUT}
          disabled={disabled}
          type="number"
          min={1}
          value={String(draft.points)}
          onChange={(e) => onPatch({ points: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}
