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
      {/* ── Primary content (rendered FIRST, at the top) ── */}
      <div>
        <label className={LABEL}>Main content — shown first (Math: the question · Reading: the passage)</label>
        <textarea
          className={`${INPUT} min-h-[140px] leading-relaxed`}
          disabled={disabled}
          placeholder="Shown at the top. Math: the full question. Reading: the passage/stimulus. LaTeX supported: \( x^2 + 1 = 0 \). Bold **like this**, italic *like this*."
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

      {/* ── Question prompt (rendered AFTER the main content, right above the choices) ── */}
      <div>
        <label className={LABEL}>Question prompt — shown right above the choices (optional)</label>
        <textarea
          className={`${INPUT} min-h-[80px] leading-relaxed`}
          disabled={disabled}
          placeholder="For a reading question: the actual question shown under the passage, e.g. “Based on the text, why …?”. Leave blank if the main content already is the question."
          value={draft.question_prompt}
          onChange={(e) => onPatch({ question_prompt: e.target.value })}
          onFocus={trackFocus((v) => onPatch({ question_prompt: v }))}
        />
      </div>
    </>
  );
}
