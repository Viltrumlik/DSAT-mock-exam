"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssessmentQuestion } from "@/features/assessments/types";
import { FormulaToolbar } from "@/components/FormulaToolbar";
import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";
import { QuestionTypeSelect } from "@/features/assessments/components/QuestionTypeSelect";
import { QuestionPromptFields } from "@/features/assessments/components/QuestionPromptFields";
import { MultipleChoiceEditor } from "@/features/assessments/components/MultipleChoiceEditor";
import { NumericEditor } from "@/features/assessments/components/NumericEditor";
import { BooleanEditor } from "@/features/assessments/components/BooleanEditor";
import { ShortTextEditor } from "@/features/assessments/components/ShortTextEditor";
import type {
  AssessmentImageKey,
  AssessmentImageState,
  AssessmentQuestionEditorDraft,
} from "@/features/assessments/components/assessmentQuestionEditorShared";

export type {
  AssessmentImageKey,
  AssessmentImageState,
  AssessmentQuestionEditorDraft,
} from "@/features/assessments/components/assessmentQuestionEditorShared";

const INPUT = STUDIO_INPUT;
const LABEL = STUDIO_FIELD_LABEL;

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  draft: AssessmentQuestionEditorDraft;
  onPatch: (p: Partial<AssessmentQuestionEditorDraft>) => void;
  disabled?: boolean;
  /** Existing saved question — used to show current image URLs. */
  savedQuestion?: AssessmentQuestion | null;
  /** Image files/clears managed by the parent. */
  imageState: AssessmentImageState;
  onSetImage: (key: AssessmentImageKey, file: File | null, clear: boolean) => void;
  /**
   * If provided, the component assigns its formula-insert handler to this ref
   * so the parent can render <FormulaToolbar> externally (e.g. in a sticky bar).
   */
  insertHandlerRef?: React.MutableRefObject<((snippet: string, cursorOffset: number) => void) | null>;
};

export function AssessmentQuestionEditorFields({
  draft,
  onPatch,
  disabled,
  savedQuestion,
  imageState,
  onSetImage,
  insertHandlerRef,
}: Props) {
  const ADV_KEY = "mastersat:builder:advanced_json_open";
  const [showAdvanced, setShowAdvanced] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(ADV_KEY) === "true"; } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(ADV_KEY, String(showAdvanced)); } catch { /* ignore */ }
  }, [showAdvanced]);

  // ── Formula insertion ──────────────────────────────────────────────────────
  const activeFieldRef = useRef<{
    el: HTMLTextAreaElement | HTMLInputElement;
    setVal: (v: string) => void;
  } | null>(null);

  const handleFormulaInsert = useCallback(
    (snippet: string, cursorOffset: number) => {
      const active = activeFieldRef.current;
      if (!active) return;
      const { el, setVal } = active;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const newVal = el.value.slice(0, start) + snippet + el.value.slice(end);
      setVal(newVal);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + cursorOffset, start + cursorOffset);
      });
    },
    [],
  );

  if (insertHandlerRef) insertHandlerRef.current = handleFormulaInsert;

  const trackFocus = useCallback(
    (setVal: (v: string) => void) =>
      (e: React.FocusEvent<HTMLTextAreaElement | HTMLInputElement>) => {
        activeFieldRef.current = { el: e.currentTarget, setVal };
      },
    [],
  );

  return (
    <div className="space-y-5">

      {/* Inline formula toolbar — only when parent doesn't render it externally */}
      {!insertHandlerRef && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="bg-surface-2/60 px-3 pt-2 pb-0">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
              Formula insert — click a symbol, then type in a field below
            </p>
          </div>
          <FormulaToolbar onInsert={handleFormulaInsert} />
        </div>
      )}

      {/* ── Question type + points ── */}
      <QuestionTypeSelect draft={draft} onPatch={onPatch} disabled={disabled} />

      {/* ── Question stem + image + stimulus excerpt ── */}
      <QuestionPromptFields
        draft={draft}
        onPatch={onPatch}
        disabled={disabled}
        savedQuestion={savedQuestion}
        imageState={imageState}
        onSetImage={onSetImage}
        trackFocus={trackFocus}
      />

      {/* ── Multiple choice ── */}
      {draft.question_type === "multiple_choice" && (
        <MultipleChoiceEditor
          draft={draft}
          onPatch={onPatch}
          disabled={disabled}
          savedQuestion={savedQuestion}
          imageState={imageState}
          onSetImage={onSetImage}
          onChoiceFocus={(el, setVal) => { activeFieldRef.current = { el, setVal }; }}
        />
      )}

      {/* ── Numeric ── */}
      {draft.question_type === "numeric" && (
        <NumericEditor draft={draft} onPatch={onPatch} disabled={disabled} />
      )}

      {/* ── Boolean ── */}
      {draft.question_type === "boolean" && (
        <BooleanEditor draft={draft} onPatch={onPatch} disabled={disabled} />
      )}

      {/* ── Short text ── */}
      {draft.question_type === "short_text" && (
        <ShortTextEditor draft={draft} onPatch={onPatch} disabled={disabled} trackFocus={trackFocus} />
      )}

      {/* ── Explanation ── */}
      <div>
        <label className={LABEL}>Explanation / solution rationale</label>
        <textarea
          className={`${INPUT} min-h-[100px] leading-relaxed`}
          disabled={disabled}
          placeholder="Explain why the correct answer is right. Shown to students after grading."
          value={draft.explanation}
          onChange={(e) => onPatch({ explanation: e.target.value })}
          onFocus={trackFocus((v) => onPatch({ explanation: v }))}
        />
      </div>

      {/* ── Advanced JSON ── */}
      <div className="border-t border-border pt-3">
        <button
          type="button"
          className="text-xs font-bold text-primary/70 hover:text-primary hover:underline"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "▾ Hide" : "▸ Show"} advanced JSON
        </button>
        {showAdvanced && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={LABEL}>Choices JSON</label>
              <textarea
                className={`${INPUT} min-h-[90px] font-mono text-xs`}
                disabled={disabled}
                value={draft.choicesText}
                onChange={(e) => onPatch({ choicesText: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL}>Correct answer JSON</label>
              <textarea
                className={`${INPUT} min-h-[90px] font-mono text-xs`}
                disabled={disabled}
                value={draft.correctAnswerText}
                onChange={(e) => onPatch({ correctAnswerText: e.target.value })}
              />
            </div>
            <div>
              <label className={LABEL}>Grading config JSON</label>
              <textarea
                className={`${INPUT} min-h-[90px] font-mono text-xs`}
                disabled={disabled}
                value={draft.gradingConfigText}
                onChange={(e) => onPatch({ gradingConfigText: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
