"use client";

import { useId } from "react";

import type { AssessmentQuestion } from "@/features/assessments/types";
import { AssessmentText } from "@/lib/assessmentText";
import { cn } from "@/lib/cn";
import { FIELD_LABEL, SERIF_AREA } from "@/features/questionsAdmin/questionLook";
import { ImageUpload } from "@/features/assessments/components/ImageUpload";
import type {
  AssessmentImageKey,
  AssessmentImageState,
  AssessmentQuestionEditorDraft,
} from "@/features/assessments/components/assessmentQuestionEditorShared";

// ─── Question stem + image + stimulus excerpt ─────────────────────────────────
// In the student's Georgia (PR 17c, as the module editor's question pane). The face sits on a wrapper:
// globals.css gives every control `font-family: inherit`, so a font utility on the textarea never applies.

export function QuestionPromptFields({
  draft,
  onPatch,
  disabled,
  savedQuestion,
  imageState,
  onSetImage,
  trackFocus,
}: {
  draft: AssessmentQuestionEditorDraft;
  onPatch: (p: Partial<AssessmentQuestionEditorDraft>) => void;
  disabled?: boolean;
  savedQuestion?: AssessmentQuestion | null;
  imageState: AssessmentImageState;
  onSetImage: (key: AssessmentImageKey, file: File | null, clear: boolean) => void;
  trackFocus: (
    setVal: (v: string) => void,
  ) => (e: React.FocusEvent<HTMLTextAreaElement | HTMLInputElement>) => void;
}) {
  const id = useId();
  return (
    <>
      {/* ── Primary content (rendered FIRST, at the top) ── */}
      <div>
        <label htmlFor={`${id}-main`} className={FIELD_LABEL}>
          Main content — shown first (Math: the question · Reading: the passage)
        </label>
        <div className="font-ms-serif">
          <textarea
            id={`${id}-main`}
            className={cn(SERIF_AREA, "min-h-[140px] text-[17px] leading-7")}
            disabled={disabled}
            placeholder="Shown at the top. Math: the full question. Reading: the passage/stimulus. LaTeX supported: \( x^2 + 1 = 0 \). Bold **like this**, italic *like this*."
            value={draft.prompt}
            onChange={(e) => onPatch({ prompt: e.target.value })}
            onFocus={trackFocus((v) => onPatch({ prompt: v }))}
          />
        </div>
        {draft.prompt.trim() && (
          <div className="animate-ms-fade-in mt-2.5 rounded-ms-ctl border border-ms-border bg-ms-card px-4 py-3">
            <p className="mb-1 text-ms-over uppercase text-ms-fg-3">Preview</p>
            <AssessmentText text={draft.prompt} block className="font-ms-serif text-[17px] leading-7 text-ms-fg" />
          </div>
        )}
      </div>

      {/* ── Question image ── */}
      <ImageUpload
        label="Question image (optional)"
        existingUrl={savedQuestion?.question_image}
        file={imageState.files.question}
        cleared={imageState.clears.question}
        onSet={(f) => onSetImage("question", f, false)}
        onClear={() => onSetImage("question", null, true)}
        onCancel={() => onSetImage("question", null, false)}
        disabled={disabled}
      />

      {/* ── Question prompt (rendered AFTER the main content, right above the choices) ── */}
      <div>
        <label htmlFor={`${id}-prompt`} className={FIELD_LABEL}>
          Question prompt — shown right above the choices (optional)
        </label>
        <div className="font-ms-serif">
          <textarea
            id={`${id}-prompt`}
            className={cn(SERIF_AREA, "min-h-[80px] text-[16px] leading-[26px]")}
            disabled={disabled}
            placeholder="For a reading question: the actual question shown under the passage, e.g. “Based on the text, why …?”. Leave blank if the main content already is the question."
            value={draft.question_prompt}
            onChange={(e) => onPatch({ question_prompt: e.target.value })}
            onFocus={trackFocus((v) => onPatch({ question_prompt: v }))}
          />
        </div>
      </div>
    </>
  );
}
