"use client";

import { useCallback, useRef } from "react";
import { CheckCircle2, Circle, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AssessmentChoice } from "@/features/assessments/types";
import { MathText } from "@/components/MathText";

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

  const seen = new Map<string, number>(); // normalised text → first index
  choices.forEach((c, i) => {
    if (!c.text.trim()) {
      issues.push({ type: "empty", index: i });
    } else {
      // Do NOT lowercase — LaTeX is case-sensitive (\( A \) ≠ \( a \)).
      // Trim only for whitespace normalisation.
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

function ChoiceRow({
  choice,
  isCorrect,
  onChangeText,
  onMarkCorrect,
  onRemove,
  onAddAfter,
  disabled,
  textareaRef,
  hasEmptyError,
  hasDuplicateError,
  canRemove,
  onFocusTextarea,
}: {
  choice: AssessmentChoice;
  isCorrect: boolean;
  onChangeText: (text: string) => void;
  onMarkCorrect: () => void;
  onRemove: () => void;
  onAddAfter: () => void;
  disabled?: boolean;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  hasEmptyError: boolean;
  hasDuplicateError: boolean;
  canRemove: boolean;
  onFocusTextarea?: (el: HTMLTextAreaElement, setVal: (v: string) => void) => void;
}) {
  const hasError = hasEmptyError || hasDuplicateError;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter (without Shift) → add new choice after current
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onAddAfter();
    }
    // Backspace on empty → remove this row
    if (e.key === "Backspace" && choice.text === "" && canRemove) {
      e.preventDefault();
      onRemove();
    }
  };

  // Auto-resize: grow with content, collapse on clear
  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <div
      className={cn(
        "group flex items-start gap-2 rounded-xl border px-2.5 py-2 transition-colors",
        isCorrect
          ? "border-emerald-300 bg-emerald-50/70"
          : hasError
            ? "border-amber-200 bg-amber-50/40"
            : "border-border bg-card hover:bg-surface-2/40",
      )}
    >
      {/* Letter badge */}
      <span
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold select-none",
          isCorrect
            ? "bg-emerald-500 text-white"
            : "border border-border bg-surface-2 text-muted-foreground",
        )}
      >
        {choice.id}
      </span>

      {/* Text input + live rendered preview */}
      <div className="mt-0.5 flex-1 min-w-0">
        <textarea
          ref={textareaRef}
          rows={1}
          disabled={disabled}
          placeholder={`Option ${choice.id}… (supports LaTeX: \( x^2 \), **bold**, *italic*)`}
          value={choice.text}
          onChange={(e) => onChangeText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onFocus={(e) => onFocusTextarea?.(e.currentTarget, onChangeText)}
          className={cn(
            "w-full resize-none overflow-hidden bg-transparent py-0 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus:outline-none",
            disabled && "cursor-not-allowed opacity-50",
          )}
        />
        {/* Live rendered preview — shown whenever the field has content.
            Lets the author see math / formatting as students will see it
            without switching focus to the right-panel preview. */}
        {choice.text.trim() && (
          <div className="mt-1 border-t border-dashed border-border/50 pt-1">
            <MathText
              text={choice.text}
              className="text-xs text-muted-foreground/70 leading-relaxed"
            />
          </div>
        )}
      </div>

      {/* Duplicate badge */}
      {hasDuplicateError && (
        <span className="mt-1.5 shrink-0 rounded-md bg-amber-100 px-1 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-amber-700">
          Dup
        </span>
      )}

      {/* Mark-correct toggle */}
      <button
        type="button"
        disabled={disabled}
        onClick={onMarkCorrect}
        title={isCorrect ? "Correct answer (click to change)" : "Mark as correct"}
        className={cn(
          "mt-0.5 shrink-0 rounded-lg p-0.5 transition-colors",
          isCorrect
            ? "text-emerald-600"
            : "text-muted-foreground/35 hover:text-emerald-500",
          disabled && "cursor-not-allowed opacity-40",
        )}
      >
        {isCorrect ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <Circle className="h-4 w-4" />
        )}
      </button>

      {/* Remove button — always present, hidden until hover, disabled at min count */}
      <button
        type="button"
        disabled={disabled || !canRemove}
        onClick={onRemove}
        title="Remove option"
        className={cn(
          "mt-0.5 shrink-0 rounded-lg p-0.5 text-muted-foreground/30 transition-colors",
          canRemove
            ? "opacity-0 hover:text-red-500 group-hover:opacity-100"
            : "opacity-0 cursor-not-allowed",
          disabled && "cursor-not-allowed",
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
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
}: {
  choices: AssessmentChoice[];
  correctId: string;
  /** Callback fires with normalised choices + the safe correct-answer id. */
  onChange: (choices: AssessmentChoice[], correctId: string) => void;
  disabled?: boolean;
  onFocusTextarea?: (el: HTMLTextAreaElement, setVal: (v: string) => void) => void;
}) {
  // Stable refs for focus management after add / remove
  const rowRefs = useRef<Array<HTMLTextAreaElement | null>>([]);

  // ── Validation ─────────────────────────────────────────────────────────────
  const issues = validateChoices(choices, correctId);
  const emptySet = new Set(
    issues
      .filter((i): i is { type: "empty"; index: number } => i.type === "empty")
      .map((i) => i.index),
  );
  const dupSet = new Set(
    issues
      .filter((i): i is { type: "duplicate"; index: number } => i.type === "duplicate")
      .map((i) => i.index),
  );
  const noCorrect = issues.some((i) => i.type === "no_correct");
  const tooFew = issues.some((i) => i.type === "too_few");

  // ── Helpers ────────────────────────────────────────────────────────────────
  const focusRow = (idx: number) => {
    setTimeout(() => rowRefs.current[idx]?.focus(), 0);
  };

  const commit = useCallback(
    (nextChoices: AssessmentChoice[], nextCorrectId: string) => {
      onChange(nextChoices, nextCorrectId);
    },
    [onChange],
  );

  // ── Mutations ──────────────────────────────────────────────────────────────

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

      // Remap correct id: old correct index shifts by 1 if it was after the insert point
      const oldCorrectIdx = choices.findIndex((c) => c.id === correctId);
      const newCorrectIdx =
        oldCorrectIdx < 0
          ? 0
          : oldCorrectIdx <= afterIdx
            ? oldCorrectIdx
            : oldCorrectIdx + 1;
      const newCorrectId = normalized[newCorrectIdx]?.id ?? normalized[0]?.id ?? "A";

      commit(normalized, newCorrectId);
      focusRow(afterIdx + 1);
    },
    [choices, correctId, commit],
  );

  const removeChoice = useCallback(
    (idx: number) => {
      if (choices.length <= 2) return; // enforce minimum
      const withRemoved = choices.filter((_, i) => i !== idx);
      const normalized = normalizeChoices(withRemoved);

      // Remap correct id
      const oldCorrectIdx = choices.findIndex((c) => c.id === correctId);
      let newCorrectIdx: number;
      if (oldCorrectIdx === idx) {
        // deleted the correct choice → pick first remaining
        newCorrectIdx = 0;
      } else if (oldCorrectIdx > idx) {
        // correct choice shifted up by one
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
    <div className="space-y-2">
      {/* Section header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Answer choices
        </span>
        {noCorrect && (
          <span className="text-[10px] font-bold text-amber-600 animate-pulse">
            Mark one choice as correct ↑
          </span>
        )}
      </div>

      {/* Inline formatting hint — shows the complete SAT-safe syntax.
          Non-interactive, non-modal. Documents the boundary deliberately:
          exactly 4 items, no more. Do not add formatting here without
          updating MathText and MATH_TEXT_BOUNDARIES.md. */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {[
          { label: "Math", sample: "\\( x^2 \\)" },
          { label: "Bold", sample: "**word**" },
          { label: "Italic", sample: "*word*" },
          { label: "Sup", sample: "x<sup>2</sup>" },
        ].map(({ label, sample }) => (
          <span key={label} className="text-[10px] text-muted-foreground/50">
            <span className="font-semibold">{label}:</span>{" "}
            <code className="rounded bg-surface-2 px-1 font-mono text-[9px]">{sample}</code>
          </span>
        ))}
      </div>

      {/* Choice rows */}
      <div className="space-y-1.5">
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
            textareaRef={(el) => {
              rowRefs.current[idx] = el;
            }}
            hasEmptyError={emptySet.has(idx)}
            hasDuplicateError={dupSet.has(idx)}
            canRemove={choices.length > 2}
            onFocusTextarea={onFocusTextarea}
          />
        ))}
      </div>

      {/* Add + validation strip */}
      <div className="flex items-center gap-3 pt-0.5">
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
          <kbd className="ml-0.5 rounded bg-surface-2 px-1 py-0.5 text-[9px] font-mono text-muted-foreground/60">
            ↵
          </kbd>
        </button>

        {tooFew && (
          <span className="text-[10px] font-semibold text-red-500">
            Need at least 2 options
          </span>
        )}

        <span className="ml-auto text-[10px] text-muted-foreground/50 tabular-nums">
          {choices.length}/8
        </span>
      </div>
    </div>
  );
}
