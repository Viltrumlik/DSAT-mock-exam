"use client";

import { useCallback, useRef } from "react";
import { ImagePlus, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AssessmentChoice } from "@/features/assessments/types";
import { AssessmentText } from "@/lib/assessmentText";

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Re-assigns sequential A/B/C/D ids after any add / remove / reorder.
 * Keeps `text` untouched — only `id` changes.
 */
export function normalizeChoices(choices: AssessmentChoice[]): AssessmentChoice[] {
  return choices.map((c, i) => ({ ...c, id: String.fromCharCode(65 + i) }));
}

/**
 * Safe hydration: parse `choicesText` JSON, normalise ids, guarantee minimum
 * of 4 default MC choices on corrupt / empty input.
 */
export function parseAndNormalizeChoices(text: string): AssessmentChoice[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = [];
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return defaultMcChoices();
  }
  const out: AssessmentChoice[] = [];
  for (const row of raw) {
    if (row && typeof row === "object" && "id" in row) {
      const text = String((row as { text?: unknown }).text ?? "");
      out.push({ id: "", text }); // id re-assigned by normalizeChoices below
    }
  }
  return normalizeChoices(out.length ? out : defaultMcChoices());
}

export function defaultMcChoices(): AssessmentChoice[] {
  return ["A", "B", "C", "D"].map((id) => ({ id, text: "" }));
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type ChoiceIssue =
  | { type: "too_few" }
  | { type: "empty"; index: number }
  | { type: "duplicate"; index: number }
  | { type: "no_correct" };

export function validateChoices(
  choices: AssessmentChoice[],
  correctId: string,
): ChoiceIssue[] {
  const issues: ChoiceIssue[] = [];

  if (choices.length < 2) issues.push({ type: "too_few" });

  const seen = new Map<string, number>();
  choices.forEach((c, i) => {
    if (!c.text.trim()) {
      issues.push({ type: "empty", index: i });
    } else {
      const norm = c.text.trim();
      if (seen.has(norm)) {
        issues.push({ type: "duplicate", index: i });
      } else {
        seen.set(norm, i);
      }
    }
  });

  if (!correctId || !choices.some((c) => c.id === correctId)) {
    issues.push({ type: "no_correct" });
  }

  return issues;
}

// ─── ChoiceRow ────────────────────────────────────────────────────────────────

type ChoiceImageProps = {
  existingUrl?: string | null;
  file?: File;
  cleared?: boolean;
  onSet: (f: File) => void;
  onClear: () => void;
  onCancel: () => void;
} | null;

function ChoiceRow({
  choice,
  isCorrect,
  onChangeText,
  onMarkCorrect,
  onRemove,
  onAddAfter,
  disabled,
  textareaRef,
  hasDuplicateError,
  canRemove,
  onFocusTextarea,
  inputClassName,
  imageProps,
}: {
  choice: AssessmentChoice;
  isCorrect: boolean;
  onChangeText: (text: string) => void;
  onMarkCorrect: () => void;
  onRemove: () => void;
  onAddAfter: () => void;
  disabled?: boolean;
  textareaRef?: React.Ref<HTMLInputElement>;
  hasDuplicateError: boolean;
  canRemove: boolean;
  onFocusTextarea?: (el: HTMLInputElement, setVal: (v: string) => void) => void;
  inputClassName: string;
  imageProps?: ChoiceImageProps;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onAddAfter();
    }
    if (e.key === "Backspace" && choice.text === "" && canRemove) {
      e.preventDefault();
      onRemove();
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        {/* Letter badge — click to mark correct */}
        <button
          type="button"
          disabled={disabled}
          onClick={onMarkCorrect}
          title={isCorrect ? "Correct answer" : "Mark as correct"}
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold transition-colors select-none",
            isCorrect
              ? "bg-emerald-500 text-white shadow-sm"
              : "border border-border bg-card text-muted-foreground hover:border-emerald-400 hover:text-emerald-600",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          {choice.id}
        </button>

        {/* Input */}
        <input
          ref={textareaRef}
          type="text"
          disabled={disabled}
          placeholder={`Option ${choice.id}`}
          value={choice.text}
          onChange={(e) => onChangeText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={(e) => onFocusTextarea?.(e.currentTarget, onChangeText)}
          className={cn(
            inputClassName,
            "flex-1",
            isCorrect && "border-emerald-400 ring-1 ring-emerald-300 focus:border-emerald-400",
            hasDuplicateError && "border-amber-400",
          )}
        />

        {/* Remove */}
        <button
          type="button"
          disabled={disabled || !canRemove}
          onClick={onRemove}
          title="Remove option"
          className={cn(
            "shrink-0 rounded-lg p-1 text-muted-foreground/30 transition-colors hover:text-red-500",
            !canRemove && "invisible",
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Live math preview */}
      {choice.text.trim() && (
        <div className="ml-10 rounded-lg border border-border/50 bg-surface-2/40 px-2.5 py-1.5">
          <AssessmentText text={choice.text} className="text-xs leading-relaxed text-foreground" />
        </div>
      )}

      {hasDuplicateError && (
        <p className="ml-10 text-[10px] font-semibold text-amber-600">Duplicate option</p>
      )}

      {/* Per-choice image upload */}
      {imageProps !== undefined && (
        <div className="ml-10 flex flex-wrap items-center gap-2">
          {imageProps?.existingUrl && !imageProps.cleared && !imageProps.file && (
            <>
              <img src={imageProps.existingUrl} alt={`Option ${choice.id}`} className="max-h-16 rounded-lg border border-border object-contain" />
              <button
                type="button"
                disabled={disabled}
                onClick={imageProps.onClear}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
              >
                <X className="h-3 w-3" /> Remove
              </button>
            </>
          )}
          {imageProps?.file && (
            <>
              <img src={URL.createObjectURL(imageProps.file)} alt="Preview" className="max-h-16 rounded-lg border border-border object-contain" />
              <button
                type="button"
                disabled={disabled}
                onClick={imageProps?.onCancel}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-surface-2 transition-colors"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
            </>
          )}
          {imageProps && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-2/30 px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-surface-2/60 transition-colors">
              <ImagePlus className="h-3 w-3" />
              {imageProps.file ? "Change image" : imageProps.existingUrl && !imageProps.cleared ? "Replace image" : "Add image"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={disabled}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) imageProps.onSet(f); }}
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ChoiceEditor ─────────────────────────────────────────────────────────────

export function ChoiceEditor({
  choices,
  correctId,
  onChange,
  disabled,
  onFocusTextarea,
  inputClassName,
  getChoiceImageProps,
}: {
  choices: AssessmentChoice[];
  correctId: string;
  onChange: (choices: AssessmentChoice[], correctId: string) => void;
  disabled?: boolean;
  onFocusTextarea?: (el: HTMLInputElement, setVal: (v: string) => void) => void;
  inputClassName: string;
  getChoiceImageProps?: (choiceId: string) => ChoiceImageProps | null;
}) {
  const rowRefs = useRef<Array<HTMLInputElement | null>>([]);

  const issues = validateChoices(choices, correctId);
  const dupSet = new Set(
    issues
      .filter((i): i is { type: "duplicate"; index: number } => i.type === "duplicate")
      .map((i) => i.index),
  );
  const noCorrect = issues.some((i) => i.type === "no_correct");
  const tooFew = issues.some((i) => i.type === "too_few");

  const focusRow = (idx: number) => {
    setTimeout(() => rowRefs.current[idx]?.focus(), 0);
  };

  const commit = useCallback(
    (nextChoices: AssessmentChoice[], nextCorrectId: string) => {
      onChange(nextChoices, nextCorrectId);
    },
    [onChange],
  );

  const updateText = (idx: number, text: string) => {
    const next = choices.map((c, i) => (i === idx ? { ...c, text } : c));
    commit(next, correctId);
  };

  const markCorrect = (idx: number) => {
    commit(choices, choices[idx].id);
  };

  const addChoiceAfter = useCallback(
    (afterIdx: number) => {
      if (choices.length >= 8) return;
      const inserted: AssessmentChoice = { id: "", text: "" };
      const withNew = [
        ...choices.slice(0, afterIdx + 1),
        inserted,
        ...choices.slice(afterIdx + 1),
      ];
      const normalized = normalizeChoices(withNew);
      const oldCorrectIdx = choices.findIndex((c) => c.id === correctId);
      const newCorrectIdx =
        oldCorrectIdx < 0 ? 0 : oldCorrectIdx <= afterIdx ? oldCorrectIdx : oldCorrectIdx + 1;
      const newCorrectId = normalized[newCorrectIdx]?.id ?? normalized[0]?.id ?? "A";
      commit(normalized, newCorrectId);
      focusRow(afterIdx + 1);
    },
    [choices, correctId, commit],
  );

  const removeChoice = useCallback(
    (idx: number) => {
      if (choices.length <= 2) return;
      const withRemoved = choices.filter((_, i) => i !== idx);
      const normalized = normalizeChoices(withRemoved);
      const oldCorrectIdx = choices.findIndex((c) => c.id === correctId);
      let newCorrectIdx: number;
      if (oldCorrectIdx === idx) {
        newCorrectIdx = 0;
      } else if (oldCorrectIdx > idx) {
        newCorrectIdx = oldCorrectIdx - 1;
      } else {
        newCorrectIdx = oldCorrectIdx;
      }
      const newCorrectId = normalized[newCorrectIdx]?.id ?? normalized[0]?.id ?? "A";
      commit(normalized, newCorrectId);
      focusRow(Math.max(0, idx - 1));
    },
    [choices, correctId, commit],
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        {noCorrect && (
          <span className="text-[10px] font-bold text-amber-600 animate-pulse">
            Click a letter badge to mark the correct answer ↓
          </span>
        )}
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {choices.map((c, idx) => (
          <ChoiceRow
            key={`row-${idx}`}
            choice={c}
            isCorrect={c.id === correctId}
            onChangeText={(text) => updateText(idx, text)}
            onMarkCorrect={() => markCorrect(idx)}
            onRemove={() => removeChoice(idx)}
            onAddAfter={() => addChoiceAfter(idx)}
            disabled={disabled}
            textareaRef={(el) => { rowRefs.current[idx] = el; }}
            hasDuplicateError={dupSet.has(idx)}
            canRemove={choices.length > 2}
            onFocusTextarea={onFocusTextarea}
            inputClassName={inputClassName}
            imageProps={getChoiceImageProps ? getChoiceImageProps(c.id) : undefined}
          />
        ))}
      </div>

      {/* Footer: add + count */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={disabled || choices.length >= 8}
          onClick={() => addChoiceAfter(choices.length - 1)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-muted-foreground transition-colors",
            "hover:border-primary/30 hover:bg-primary/5 hover:text-primary",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Add option
          <kbd className="ml-0.5 rounded bg-surface-2 px-1 py-0.5 text-[9px] font-mono text-muted-foreground/60">↵</kbd>
        </button>

        {tooFew && (
          <span className="text-[10px] font-semibold text-red-500">Need at least 2 options</span>
        )}

        <span className="ml-auto text-[10px] text-muted-foreground/50 tabular-nums">
          {choices.length}/8
        </span>
      </div>
    </div>
  );
}
