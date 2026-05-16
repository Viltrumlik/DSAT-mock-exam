"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssessmentQuestionType } from "@/features/assessments/types";
import { ChoiceEditor, defaultMcChoices, parseAndNormalizeChoices } from "@/features/assessments/components/ChoiceEditor";
import { FormulaToolbar } from "@/components/FormulaToolbar";
import { MathText } from "@/components/MathText";
import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";

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

// Use the same INPUT token as the pastpaper editor for visual consistency.
// The parent (BuilderSetEditorContainer) also defines a slightly different
// INPUT with bg-background + shadow-sm — but we intentionally use STUDIO_INPUT
// here so all field types (textarea, select, input) share one definition.
const INPUT = STUDIO_INPUT;
const LABEL = STUDIO_FIELD_LABEL;

type Props = {
  draft: AssessmentQuestionEditorDraft;
  onPatch: (p: Partial<AssessmentQuestionEditorDraft>) => void;
  disabled?: boolean;
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
  disabled,
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

  const gradingObj = useMemo(
    () => parseJson<Record<string, unknown>>(draft.gradingConfigText, {}),
    [draft.gradingConfigText],
  );
  const toleranceRaw = gradingObj.tolerance;
  const toleranceStr =
    typeof toleranceRaw === "number" && Number.isFinite(toleranceRaw)
      ? String(toleranceRaw)
      : typeof toleranceRaw === "string"
        ? toleranceRaw
        : "";

  const setGradingPatch = (patch: Record<string, unknown>) => {
    const next = { ...gradingObj, ...patch };
    if (next.tolerance === "" || next.tolerance === null || typeof next.tolerance === "undefined")
      delete next.tolerance;
    onPatch({ gradingConfigText: JSON.stringify(next, null, 2) });
  };

  const correctMcId = useMemo(() => {
    const ca = parseJson<unknown>(draft.correctAnswerText, null);
    if (ca == null || ca === "") return choices[0]?.id ?? "A";
    const s = String(ca);
    return choices.some((c) => c.id === s) ? s : (choices[0]?.id ?? "A");
  }, [draft.correctAnswerText, choices]);

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

      {/* ── Question type + meta ── */}
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
            <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Preview
            </p>
            <MathText text={draft.prompt} block className="text-sm leading-relaxed text-foreground" />
          </div>
        )}
      </div>

      {/* ── Multiple choice ── */}
      {draft.question_type === "multiple_choice" && (
        <div className="rounded-2xl border border-border bg-surface-2/30 p-4 space-y-3">
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
            onFocusTextarea={(el, setVal) => {
              activeFieldRef.current = { el, setVal };
            }}
          />
        </div>
      )}

      {/* ── Numeric ── */}
      {draft.question_type === "numeric" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Correct value</label>
            <input
              className={INPUT}
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
              onFocus={trackFocus((v) => {
                const raw = v.trim();
                if (raw === "") onPatch({ correctAnswerText: JSON.stringify(null) });
                else if (!Number.isNaN(Number(raw))) onPatch({ correctAnswerText: JSON.stringify(Number(raw)) });
                else onPatch({ correctAnswerText: JSON.stringify(raw) });
              })}
            />
          </div>
          <div>
            <label className={LABEL}>Tolerance (±)</label>
            <input
              className={INPUT}
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

      {/* ── Boolean ── */}
      {draft.question_type === "boolean" && (
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
      )}

      {/* ── Short text ── */}
      {draft.question_type === "short_text" && (
        <div>
          <label className={LABEL}>Expected answer (exact match)</label>
          <textarea
            className={`${INPUT} min-h-[80px] leading-relaxed`}
            disabled={disabled}
            placeholder="Enter the exact expected answer. Supports LaTeX: \( x^2 \), **bold**, *italic*"
            value={(() => {
              const ca = parseJson<unknown>(draft.correctAnswerText, "");
              if (typeof ca === "string") return ca;
              if (Array.isArray(ca) && ca.every((x) => typeof x === "string"))
                return (ca as string[]).join(", ");
              return ca == null ? "" : JSON.stringify(ca);
            })()}
            onChange={(e) => onPatch({ correctAnswerText: JSON.stringify(e.target.value) })}
            onFocus={trackFocus((v) => onPatch({ correctAnswerText: JSON.stringify(v) }))}
          />
        </div>
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

      {/* ── Advanced JSON (collapsed by default) ── */}
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
