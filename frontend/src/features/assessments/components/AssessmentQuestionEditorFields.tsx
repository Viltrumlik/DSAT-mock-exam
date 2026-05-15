"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssessmentQuestionType } from "@/features/assessments/types";
import { ChoiceEditor, defaultMcChoices, parseAndNormalizeChoices } from "@/features/assessments/components/ChoiceEditor";
import { FormulaToolbar } from "@/components/FormulaToolbar";

export type AssessmentQuestionEditorDraft = {
  prompt: string;
  question_type: AssessmentQuestionType;
  order: number;
  points: number;
  is_active: boolean;
  explanation: string;
  choicesText: string;
  correctAnswerText: string;
  gradingConfigText: string;
};

function parseJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

type Props = {
  draft: AssessmentQuestionEditorDraft;
  onPatch: (p: Partial<AssessmentQuestionEditorDraft>) => void;
  inputClassName: string;
  disabled?: boolean;
  fieldLabelClass?: string;
  /**
   * If provided, the component assigns its formula-insert handler to this ref
   * so the parent can render <FormulaToolbar> externally (e.g. in a sticky
   * section above the scrollable form body).
   * When omitted, a FormulaToolbar is rendered inline at the top of the form.
   */
  insertHandlerRef?: React.MutableRefObject<((snippet: string, cursorOffset: number) => void) | null>;
};

export function AssessmentQuestionEditorFields({
  draft,
  onPatch,
  inputClassName,
  disabled,
  fieldLabelClass = "text-[11px] font-bold text-muted-foreground uppercase tracking-widest",
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

  const choices = useMemo(
    () => parseAndNormalizeChoices(draft.choicesText),
    [draft.choicesText],
  );

  const gradingObj = useMemo(() => parseJson<Record<string, unknown>>(draft.gradingConfigText, {}), [draft.gradingConfigText]);
  const toleranceRaw = gradingObj.tolerance;
  const toleranceStr =
    typeof toleranceRaw === "number" && Number.isFinite(toleranceRaw)
      ? String(toleranceRaw)
      : typeof toleranceRaw === "string"
        ? toleranceRaw
        : "";

  const setGradingPatch = (patch: Record<string, unknown>) => {
    const next = { ...gradingObj, ...patch };
    if (next.tolerance === "" || next.tolerance === null || typeof next.tolerance === "undefined") delete next.tolerance;
    onPatch({ gradingConfigText: JSON.stringify(next, null, 2) });
  };

  const correctMcId = useMemo(() => {
    const ca = parseJson<unknown>(draft.correctAnswerText, null);
    if (ca == null || ca === "") return choices[0]?.id ?? "A";
    const s = String(ca);
    return choices.some((c) => c.id === s) ? s : (choices[0]?.id ?? "A");
  }, [draft.correctAnswerText, choices]);

  // ── Formula insertion ──────────────────────────────────────────────────────
  // Tracks the textarea/input that most recently had focus so the toolbar
  // inserts at the right cursor position without stealing blur.
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

  // Expose handler to parent so it can render the toolbar in a sticky section.
  if (insertHandlerRef) insertHandlerRef.current = handleFormulaInsert;

  // Helper to create onFocus handler for a textarea/input
  const trackFocus = useCallback(
    (setVal: (v: string) => void) =>
      (e: React.FocusEvent<HTMLTextAreaElement | HTMLInputElement>) => {
        activeFieldRef.current = { el: e.currentTarget, setVal };
      },
    [],
  );

  return (
    <div className="space-y-5">

      {/* ── Formula toolbar (inline fallback — only shown when parent does not
           render it externally via insertHandlerRef) ──────────────────────── */}
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

      {/* Question type + meta row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="col-span-2 flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Question type</span>
          <select
            className={inputClassName}
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

        <div className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Points</span>
          <input
            className={inputClassName}
            disabled={disabled}
            type="number"
            min={1}
            value={String(draft.points)}
            onChange={(e) => onPatch({ points: Number(e.target.value) })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Active</span>
          <select
            className={inputClassName}
            disabled={disabled}
            value={String(draft.is_active)}
            onChange={(e) => onPatch({ is_active: e.target.value === "true" })}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
      </div>

      {/* Prompt */}
      <div className="flex flex-col gap-1.5">
        <span className={fieldLabelClass}>Question text (prompt / stem)</span>
        <textarea
          className={`${inputClassName} min-h-[160px] leading-relaxed`}
          disabled={disabled}
          placeholder="Enter the question text here. Supports plain text and LaTeX math (e.g. \( x^2 + 1 = 0 \))."
          value={draft.prompt}
          onChange={(e) => onPatch({ prompt: e.target.value })}
          onFocus={trackFocus((v) => onPatch({ prompt: v }))}
        />
      </div>

      {/* Multiple choice answers */}
      {draft.question_type === "multiple_choice" && (
        <div className="rounded-2xl border border-border bg-surface-2/30 p-4">
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
          />
        </div>
      )}

      {/* Numeric answer */}
      {draft.question_type === "numeric" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass}>Correct value</span>
            <input
              className={inputClassName}
              disabled={disabled}
              type="text"
              inputMode="decimal"
              placeholder="e.g. 42 or 3.14"
              value={String(parseJson(draft.correctAnswerText, "") ?? "")}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") onPatch({ correctAnswerText: JSON.stringify(null) });
                else if (!Number.isNaN(Number(raw))) onPatch({ correctAnswerText: JSON.stringify(Number(raw)) });
                else onPatch({ correctAnswerText: JSON.stringify(raw) });
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={fieldLabelClass}>Tolerance (±)</span>
            <input
              className={inputClassName}
              disabled={disabled}
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={toleranceStr}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") {
                  const next = { ...gradingObj };
                  delete next.tolerance;
                  onPatch({ gradingConfigText: JSON.stringify(next, null, 2) });
                } else if (!Number.isNaN(Number(raw))) {
                  setGradingPatch({ tolerance: Number(raw) });
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Boolean answer */}
      {draft.question_type === "boolean" && (
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Correct answer</span>
          <select
            className={inputClassName}
            disabled={disabled}
            value={String(parseJson(draft.correctAnswerText, true))}
            onChange={(e) => onPatch({ correctAnswerText: JSON.stringify(e.target.value === "true") })}
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </div>
      )}

      {/* Short text answer */}
      {draft.question_type === "short_text" && (
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabelClass}>Expected answer (exact match)</span>
          <textarea
            className={`${inputClassName} min-h-[72px] leading-relaxed`}
            disabled={disabled}
            placeholder={`Enter the exact expected answer.\nSupports LaTeX: \\( x^2 \\), **bold**, *italic*`}
            value={(() => {
              const ca = parseJson<unknown>(draft.correctAnswerText, "");
              if (typeof ca === "string") return ca;
              if (Array.isArray(ca) && ca.every((x) => typeof x === "string")) return (ca as string[]).join(", ");
              return ca == null ? "" : JSON.stringify(ca);
            })()}
            onChange={(e) => onPatch({ correctAnswerText: JSON.stringify(e.target.value) })}
            onFocus={trackFocus((v) => onPatch({ correctAnswerText: JSON.stringify(v) }))}
          />
        </div>
      )}

      {/* Explanation */}
      <div className="flex flex-col gap-1.5">
        <span className={fieldLabelClass}>Explanation / solution rationale</span>
        <textarea
          className={`${inputClassName} min-h-[100px] leading-relaxed`}
          disabled={disabled}
          placeholder="Explain why the correct answer is right. Shown to students after grading."
          value={draft.explanation}
          onChange={(e) => onPatch({ explanation: e.target.value })}
          onFocus={trackFocus((v) => onPatch({ explanation: v }))}
        />
      </div>

      {/* Advanced JSON toggle */}
      <div className="border-t border-border pt-3">
        <button
          type="button"
          className="text-xs font-bold text-primary/70 hover:text-primary hover:underline"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "▾ Hide" : "▸ Show"} advanced JSON (choices, correct answer, grading config)
        </button>
        {showAdvanced && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <span className={fieldLabelClass}>Choices JSON</span>
              <textarea
                className={`${inputClassName} min-h-[90px] font-mono text-xs`}
                disabled={disabled}
                value={draft.choicesText}
                onChange={(e) => onPatch({ choicesText: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={fieldLabelClass}>Correct answer JSON</span>
              <textarea
                className={`${inputClassName} min-h-[90px] font-mono text-xs`}
                disabled={disabled}
                value={draft.correctAnswerText}
                onChange={(e) => onPatch({ correctAnswerText: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={fieldLabelClass}>Grading config JSON</span>
              <textarea
                className={`${inputClassName} min-h-[90px] font-mono text-xs`}
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
