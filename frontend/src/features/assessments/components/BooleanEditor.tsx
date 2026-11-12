"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { FIELD_LABEL, PICK, PICK_OFF, PICK_ON } from "@/features/questionsAdmin/questionLook";
import {
  parseJson,
  type AssessmentQuestionEditorDraft,
} from "@/features/assessments/components/assessmentQuestionEditorShared";

// ─── Boolean ──────────────────────────────────────────────────────────────────
// True / False as the module editor's two choice-shaped buttons (PR 17c); the picked one green.

export function BooleanEditor({
  draft,
  onPatch,
  disabled,
}: {
  draft: AssessmentQuestionEditorDraft;
  onPatch: (p: Partial<AssessmentQuestionEditorDraft>) => void;
  disabled?: boolean;
}) {
  const value = String(parseJson(draft.correctAnswerText, true));
  return (
    <div>
      <p className={FIELD_LABEL}>Correct answer</p>
      <div role="group" aria-label="Correct answer" className="flex gap-3">
        {[
          { label: "True", val: "true" },
          { label: "False", val: "false" },
        ].map(({ label, val }) => {
          const on = value === val;
          return (
            <button
              key={val}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onPatch({ correctAnswerText: JSON.stringify(val === "true") })}
              className={cn(PICK, "h-11 flex-1 gap-2 text-[15px] disabled:cursor-not-allowed disabled:opacity-60", on ? PICK_ON : PICK_OFF)}
            >
              {on ? <Icon name="ok" size="sm" className="size-4" /> : null}
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
