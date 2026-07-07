"use client";

import type { AssessmentQuestion } from "@/features/assessments/types";
import { AssessmentText } from "@/lib/assessmentText";
import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";
import { ImageUpload } from "@/features/assessments/components/ImageUpload";
import type {
  AssessmentImageKey,
  AssessmentImageState,
  AssessmentQuestionEditorDraft,
} from "@/features/assessments/components/assessmentQuestionEditorShared";

const INPUT = STUDIO_INPUT;
const LABEL = STUDIO_FIELD_LABEL;

// ─── Question stem + image + stimulus excerpt ─────────────────────────────────

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
  return (
    <>
      {/* ── Question text ── */}
      <div>
        <label className={LABEL}>Question text (stem)</label>
        <textarea
          className={`${INPUT} min-h-[140px] leading-relaxed`}
          disabled={disabled}
          placeholder="Enter the full question text here. LaTeX math is supported: \( x^2 + 1 = 0 \)"
          value={draft.prompt}
          onChange={(e) => onPatch({ prompt: e.target.value })}
          onFocus={trackFocus((v) => onPatch({ prompt: v }))}
        />
        {draft.prompt.trim() && (
          <div className="mt-2 rounded-xl border border-border/60 bg-surface-2/50 px-3 py-2.5">
            <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Preview</p>
            <AssessmentText text={draft.prompt} block className="text-sm leading-relaxed text-foreground" />
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

      {/* ── Stimulus / passage excerpt ── */}
      <div>
        <label className={LABEL}>Stimulus / passage excerpt (optional)</label>
        <textarea
          className={`${INPUT} min-h-[80px] leading-relaxed`}
          disabled={disabled}
          placeholder="Secondary text shown above the answer choices — e.g. a short passage excerpt or graph description."
          value={draft.question_prompt}
          onChange={(e) => onPatch({ question_prompt: e.target.value })}
          onFocus={trackFocus((v) => onPatch({ question_prompt: v }))}
        />
      </div>
    </>
  );
}
