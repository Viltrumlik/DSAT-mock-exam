"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AssessmentQuestion } from "@/features/assessments/types";
import { FormulaToolbar } from "@/components/FormulaToolbar";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { FIELD_LABEL, SERIF_AREA } from "@/features/questionsAdmin/questionLook";
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

/** The advanced JSON fields: the console's area shell; the mono face sits on a wrapper (controls inherit). */
const JSON_AREA = cn(SERIF_AREA, "min-h-[90px] text-[13px] leading-5");

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

  // Expose the formula-insert handler to the parent via the ref after render
  // (assigning a ref during render is disallowed). The parent reads it inside
  // event handlers, so an effect-time assignment preserves the behaviour.
  useEffect(() => {
    if (insertHandlerRef) insertHandlerRef.current = handleFormulaInsert;
  });

  const id = useId();

  const trackFocus = useCallback(
    (setVal: (v: string) => void) =>
      (e: React.FocusEvent<HTMLTextAreaElement | HTMLInputElement>) => {
        activeFieldRef.current = { el: e.currentTarget, setVal };
      },
    [],
  );

  return (
    // The set editor's question, in the console's look (design handoff v0.3, PR 17c): the module editor's fields,
    // the content in the student's Georgia.
    <div className="flex flex-col gap-6">

      {/* Inline formula toolbar — only when parent doesn't render it externally */}
      {!insertHandlerRef && (
        <div className="overflow-hidden rounded-ms-ctl border border-ms-border bg-ms-card">
          <p className="px-3 pt-2 text-ms-over uppercase text-ms-fg-3">
            Formula insert — click a symbol, then type in a field below
          </p>
          <FormulaToolbar look="console" onInsert={handleFormulaInsert} />
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
        <label htmlFor={`${id}-explanation`} className={FIELD_LABEL}>
          Explanation / solution rationale
        </label>
        <div className="font-ms-serif">
          <textarea
            id={`${id}-explanation`}
            className={cn(SERIF_AREA, "min-h-[100px] text-[16px] leading-[26px]")}
            disabled={disabled}
            placeholder="Explain why the correct answer is right. Shown to students after grading."
            value={draft.explanation}
            onChange={(e) => onPatch({ explanation: e.target.value })}
            onFocus={trackFocus((v) => onPatch({ explanation: v }))}
          />
        </div>
      </div>

      {/* ── Advanced JSON ── */}
      <div className="border-t border-ms-line pt-3">
        <button
          type="button"
          aria-expanded={showAdvanced}
          className="ms-transition inline-flex items-center gap-1 rounded-[8px] px-1 py-0.5 text-[13px] font-semibold text-ms-primary-text hover:underline"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <Icon name="right" size="sm" className={cn("size-3.5 transition-transform duration-200", showAdvanced && "rotate-90")} />
          {showAdvanced ? "Hide" : "Show"} advanced JSON
        </button>
        {showAdvanced && (
          <div className="animate-ms-fade-in mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor={`${id}-choices-json`} className={FIELD_LABEL}>Choices JSON</label>
              <div className="font-ms-mono">
                <textarea
                  id={`${id}-choices-json`}
                  className={JSON_AREA}
                  disabled={disabled}
                  value={draft.choicesText}
                  onChange={(e) => onPatch({ choicesText: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label htmlFor={`${id}-answer-json`} className={FIELD_LABEL}>Correct answer JSON</label>
              <div className="font-ms-mono">
                <textarea
                  id={`${id}-answer-json`}
                  className={JSON_AREA}
                  disabled={disabled}
                  value={draft.correctAnswerText}
                  onChange={(e) => onPatch({ correctAnswerText: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label htmlFor={`${id}-grading-json`} className={FIELD_LABEL}>Grading config JSON</label>
              <div className="font-ms-mono">
                <textarea
                  id={`${id}-grading-json`}
                  className={JSON_AREA}
                  disabled={disabled}
                  value={draft.gradingConfigText}
                  onChange={(e) => onPatch({ gradingConfigText: e.target.value })}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
