"use client";

import { useMemo } from "react";
import type { AssessmentQuestion } from "@/features/assessments/types";
import { ChoiceEditor, parseAndNormalizeChoices } from "@/features/assessments/components/ChoiceEditor";
import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";
import {
  parseJson,
  type AssessmentImageKey,
  type AssessmentImageState,
  type AssessmentQuestionEditorDraft,
} from "@/features/assessments/components/assessmentQuestionEditorShared";

const INPUT = STUDIO_INPUT;
const LABEL = STUDIO_FIELD_LABEL;

const choiceImgKey = (id: string): AssessmentImageKey | null => {
  const map: Record<string, AssessmentImageKey> = { A: "a", B: "b", C: "c", D: "d" };
  return map[id] ?? null;
};

// ─── Multiple choice ──────────────────────────────────────────────────────────

export function MultipleChoiceEditor({
  draft,
  onPatch,
  disabled,
  savedQuestion,
  imageState,
  onSetImage,
  onChoiceFocus,
}: {
  draft: AssessmentQuestionEditorDraft;
  onPatch: (p: Partial<AssessmentQuestionEditorDraft>) => void;
  disabled?: boolean;
  savedQuestion?: AssessmentQuestion | null;
  imageState: AssessmentImageState;
  onSetImage: (key: AssessmentImageKey, file: File | null, clear: boolean) => void;
  onChoiceFocus: (el: HTMLInputElement, setVal: (v: string) => void) => void;
}) {
  const choices = useMemo(() => parseAndNormalizeChoices(draft.choicesText), [draft.choicesText]);

  const correctMcId = useMemo(() => {
    // Preserve the user's actual pick — even if it's currently empty, do not
    // fall back to choices[0] silently. The previous fallback caused the UI
    // to show "A" as selected whenever the user re-opened a question they
    // had set to "D", because the round-trip computed "no selection" briefly
    // and then snapped to A.
    const ca = parseJson<unknown>(draft.correctAnswerText, null);
    if (ca == null || ca === "") return "";
    return String(ca);
  }, [draft.correctAnswerText]);

  return (
    <div className="rounded-2xl border border-border bg-surface-2/30 p-4 space-y-4">
      <label className={LABEL}>Answer choices</label>
      <ChoiceEditor
        choices={choices}
        correctId={correctMcId}
        onChange={(nextChoices, nextCorrectId) => {
          onPatch({
            choicesText: JSON.stringify(nextChoices, null, 2),
            correctAnswerText: JSON.stringify(nextCorrectId),
          });
        }}
        disabled={disabled}
        inputClassName={INPUT}
        onFocusTextarea={(el, setVal) => { onChoiceFocus(el, setVal); }}
        // Per-choice image state
        getChoiceImageProps={(choiceId) => {
          const key = choiceImgKey(choiceId);
          if (!key) return null;
          const dbField = `option_${key}_image` as keyof AssessmentQuestion;
          return {
            existingUrl: savedQuestion?.[dbField] as string | null | undefined,
            file: imageState.files[key],
            cleared: imageState.clears[key],
            onSet: (f: File) => onSetImage(key, f, false),
            onClear: () => onSetImage(key, null, true),
            onCancel: () => onSetImage(key, null, false),
          };
        }}
      />
    </div>
  );
}
