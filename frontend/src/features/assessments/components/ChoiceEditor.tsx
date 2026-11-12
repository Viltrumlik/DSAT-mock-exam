"use client";

import { useCallback, useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { AssessmentChoice } from "@/features/assessments/types";
import { AssessmentText } from "@/lib/assessmentText";
import { Badge, Button, Kbd } from "@/features/console/ui";
import { ImageUpload } from "@/features/assessments/components/ImageUpload";
import {
  CHOICE,
  CHOICE_IDLE,
  CHOICE_KEY,
  LETTER,
  LETTER_IDLE,
  LETTER_KEY,
  hasMarkup,
} from "@/features/questionsAdmin/questionLook";

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

/** Grow a choice textarea to fit its content so multi-line options aren't clipped. */
function autoGrowTextarea(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
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
  imageProps,
}: {
  choice: AssessmentChoice;
  isCorrect: boolean;
  onChangeText: (text: string) => void;
  onMarkCorrect: () => void;
  onRemove: () => void;
  onAddAfter: () => void;
  disabled?: boolean;
  textareaRef?: (el: HTMLTextAreaElement | null) => void;
  hasDuplicateError: boolean;
  canRemove: boolean;
  onFocusTextarea?: (el: HTMLTextAreaElement, setVal: (v: string) => void) => void;
  imageProps?: ChoiceImageProps;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter now inserts a real newline (textarea default) so an option can span
    // multiple lines. Cmd/Ctrl+Enter is the power-user shortcut to add a new option.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onAddAfter();
      return;
    }
    if (e.key === "Backspace" && choice.text === "" && canRemove) {
      e.preventDefault();
      onRemove();
    }
  };

  return (
    // The choice as the student sees it (PR 17c, the module editor's cards): the answer key's card in green.
    <div
      data-choice={choice.id}
      className={cn(
        CHOICE,
        "flex-col gap-2 focus-within:border-ms-primary",
        isCorrect ? CHOICE_KEY : CHOICE_IDLE,
        hasDuplicateError && !isCorrect && "border-ms-attention",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Letter badge — click to mark correct */}
        <button
          type="button"
          disabled={disabled}
          onClick={onMarkCorrect}
          title={isCorrect ? "Correct answer" : "Mark as correct"}
          aria-label={isCorrect ? `Option ${choice.id} is the correct answer` : `Mark option ${choice.id} as correct`}
          aria-pressed={isCorrect}
          className={cn(
            LETTER,
            "ms-transition select-none",
            isCorrect ? LETTER_KEY : cn(LETTER_IDLE, "hover:border-ms-positive hover:text-ms-positive-fg"),
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          {isCorrect ? <Icon name="check" size="sm" className="size-4" /> : choice.id}
        </button>

        {/* Input — a textarea so Enter inserts a newline; auto-grows to fit content. Georgia sits on the
            wrapper: globals.css gives every control `font-family: inherit`. */}
        <div className="min-w-0 flex-1 font-ms-serif">
          <textarea
            ref={(el) => {
              textareaRef?.(el);
              autoGrowTextarea(el);
            }}
            rows={1}
            disabled={disabled}
            aria-label={`Option ${choice.id}`}
            placeholder={`Option ${choice.id}`}
            value={choice.text}
            onChange={(e) => {
              onChangeText(e.target.value);
              autoGrowTextarea(e.currentTarget);
            }}
            onKeyDown={handleKeyDown}
            onFocus={(e) => onFocusTextarea?.(e.currentTarget, onChangeText)}
            className="min-h-7 w-full resize-none overflow-hidden bg-transparent py-0.5 text-[16px] leading-6 text-ms-fg outline-none placeholder:text-ms-fg-3 disabled:cursor-not-allowed"
          />
        </div>

        {isCorrect ? (
          <Badge tone="positive" className="mt-0.5 shrink-0">
            Answer key · {choice.id}
          </Badge>
        ) : null}

        {/* Remove */}
        <button
          type="button"
          disabled={disabled || !canRemove}
          onClick={onRemove}
          title="Remove option"
          aria-label={`Remove option ${choice.id}`}
          className={cn(
            "ms-transition grid size-7 shrink-0 place-items-center rounded-[8px] text-ms-fg-3 hover:bg-ms-critical-soft hover:text-ms-critical-fg",
            !canRemove && "invisible",
          )}
        >
          <Icon name="x" size="sm" className="size-3.5" />
        </button>
      </div>

      {/* Live math preview — only when the choice carries math or markup; a plain choice already reads as
          itself in the card (as in the module editor). */}
      {hasMarkup(choice.text) && (
        <div className="ml-10 rounded-[10px] bg-ms-surface px-3 py-2">
          <AssessmentText text={choice.text} preserveNewlines className="font-ms-serif text-[15px] leading-6 text-ms-fg" />
        </div>
      )}

      {hasDuplicateError && (
        <p className="ml-10 text-[13px] font-semibold text-ms-attention-fg">Duplicate option</p>
      )}

      {/* Per-choice image upload — the shared widget, so its preview URL is made once and freed (it was made
          anew on every render and never revoked). */}
      {imageProps ? (
        <div className="ml-10">
          <ImageUpload
            label={`Option ${choice.id}`}
            showLabel={false}
            size="sm"
            words={{ add: "Add image", change: "Change image", replace: "Replace image" }}
            existingUrl={imageProps.existingUrl}
            file={imageProps.file}
            cleared={imageProps.cleared}
            onSet={imageProps.onSet}
            onClear={imageProps.onClear}
            onCancel={imageProps.onCancel}
            disabled={disabled}
          />
        </div>
      ) : null}
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
  getChoiceImageProps,
}: {
  choices: AssessmentChoice[];
  correctId: string;
  onChange: (choices: AssessmentChoice[], correctId: string) => void;
  disabled?: boolean;
  onFocusTextarea?: (el: HTMLTextAreaElement, setVal: (v: string) => void) => void;
  getChoiceImageProps?: (choiceId: string) => ChoiceImageProps | null;
}) {
  const rowRefs = useRef<Array<HTMLTextAreaElement | null>>([]);

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
    <div className="flex flex-col gap-2.5">
      {noCorrect && (
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ms-attention-fg">
          <Icon name="warn" size="sm" className="size-3.5" />
          Click a letter badge to mark the correct answer ↓
        </p>
      )}

      {/* Rows */}
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
          imageProps={getChoiceImageProps ? getChoiceImageProps(c.id) : undefined}
        />
      ))}

      {/* Footer: add + count */}
      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          disabled={disabled || choices.length >= 8}
          onClick={() => addChoiceAfter(choices.length - 1)}
        >
          Add option
          <Kbd className="ml-0.5">⌘↵</Kbd>
        </Button>

        {tooFew && (
          <span className="text-[13px] font-semibold text-ms-critical-fg">Need at least 2 options</span>
        )}

        <span className="ml-auto text-[13px] tabular-nums text-ms-fg-3">
          {choices.length}/8
        </span>
      </div>
    </div>
  );
}
