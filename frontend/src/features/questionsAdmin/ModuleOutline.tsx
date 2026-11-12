"use client";

import type { CSSProperties, KeyboardEvent, Ref } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Icon } from "@/components/ui/Icon";
import { Kbd, useModKey } from "@/features/console/ui";
import { cn } from "@/lib/cn";
import type { AdminModuleQuestion } from "@/features/questionsAdmin/types";

/**
 * The module editor's outline (design handoff v0.3, Shell board "Builder editor · full-screen", PR 14a):
 * one row per question — grip, number, its words, its chips in the subject's colour, and a dot that says
 * whether it is ready. The rows reorder by drag (Motion board, "Drag lift") or by ⌥↑ / ⌥↓.
 */

/** Answer format shown in the midterm question editor instead of SAT types. */
export type MidtermFormat = "mc" | "numeric" | "short_text" | "true_false";

/** Infer midterm answer format from existing question fields. */
export function detectMidtermFormat(q: AdminModuleQuestion): MidtermFormat {
  if (q.is_math_input) return "numeric";
  const a = (q.option_a ?? "").trim().toLowerCase();
  const b = (q.option_b ?? "").trim().toLowerCase();
  if (a === "true" && b === "false" && !(q.option_c ?? "").trim() && !(q.option_d ?? "").trim()) {
    return "true_false";
  }
  return "mc";
}

// ── the dot ──────────────────────────────────────────────────────────────

export type QuestionVerdict = "ready" | "look" | "nokey";

/**
 * A blank correct answer is the one thing a student would be marked wrong for whatever they chose, so it
 * outranks the rest; a question with no words, or of a type this section does not take, needs a look.
 */
export function questionVerdict(q: AdminModuleQuestion, wrongType: boolean): QuestionVerdict {
  if (!(q.correct_answer ?? "").trim()) return "nokey";
  if (!(q.question_text ?? "").trim() || wrongType) return "look";
  return "ready";
}

export const VERDICT: Record<QuestionVerdict, { dot: string; word: string }> = {
  ready: { dot: "bg-ms-positive", word: "ready" },
  look: { dot: "bg-ms-attention", word: "needs a look" },
  nokey: { dot: "bg-ms-critical", word: "no answer key" },
};

// ── chips ────────────────────────────────────────────────────────────────

// No `uppercase` here: `cn` does not merge Tailwind classes, so a chip that must keep its case (the
// score's "10b") could not undo it. The type chips ask for it themselves.
const CHIP = "inline-flex h-[18px] items-center rounded-[6px] px-1.5 text-[11px] font-semibold leading-none tracking-[0.02em]";
const NEUTRAL_CHIP = "bg-ms-surface-2 text-ms-fg-2";
/** Math in violet, Reading and Writing in rose — the subjects' own colours across the Builder. */
const TYPE_CHIP: Record<string, string> = {
  MATH: "bg-ms-math-soft text-ms-math-fg",
  READING: "bg-ms-rw-soft text-ms-rw-fg",
  WRITING: "bg-ms-rw-soft text-ms-rw-fg",
};
const MIDTERM_FORMAT_LABEL: Record<MidtermFormat, string> = { true_false: "T/F", numeric: "Num", short_text: "Text", mc: "MC" };

function Chips({ q, examKind, wrongType }: { q: AdminModuleQuestion; examKind?: string; wrongType: boolean }) {
  const isMidtermRow = examKind === "MIDTERM";
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-1">
      {isMidtermRow ? (
        // For midterm rows, the answer format instead of the SAT type.
        <span className={cn(CHIP, "uppercase", TYPE_CHIP[q.question_type] ?? NEUTRAL_CHIP)}>{MIDTERM_FORMAT_LABEL[detectMidtermFormat(q)]}</span>
      ) : (
        <span className={cn(CHIP, "uppercase", TYPE_CHIP[q.question_type] ?? NEUTRAL_CHIP)}>{q.question_type}</span>
      )}
      {!isMidtermRow && q.is_math_input ? <span className={cn(CHIP, NEUTRAL_CHIP)}>INPUT</span> : null}
      {!isMidtermRow ? <span className={cn(CHIP, NEUTRAL_CHIP, "tabular-nums")}>{q.score ?? 10}b</span> : null}
      {wrongType ? (
        <span title="Wrong question type for this section" className="inline-flex text-ms-attention-fg">
          <Icon name="warn" size="sm" label="Wrong question type for this section" className="size-3.5" />
        </span>
      ) : null}
    </span>
  );
}

function RowBody({ q, index, examKind, wrongType }: { q: AdminModuleQuestion; index: number; examKind?: string; wrongType: boolean }) {
  const verdict = VERDICT[questionVerdict(q, wrongType)];
  return (
    <>
      <span className="w-7 shrink-0 pt-px text-[13px] font-semibold tabular-nums text-ms-fg-3">Q{index + 1}</span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[14px] font-medium leading-5 text-ms-fg">
          {q.question_text?.trim() || <em className="font-normal text-ms-fg-3">No text yet</em>}
        </span>
        <Chips q={q} examKind={examKind} wrongType={wrongType} />
      </span>
      <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", verdict.dot)} />
      <span className="sr-only">, {verdict.word}</span>
    </>
  );
}

// ── one row ──────────────────────────────────────────────────────────────

/** "Others slide 200 ms" (Motion board), on the console's own curve. */
const SLIDE = { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" };

export function OutlineRow({
  q,
  index,
  selected,
  reordering,
  wrongType,
  examKind,
  reduceMotion,
  onSelect,
  onMove,
  rowRef,
}: {
  q: AdminModuleQuestion;
  index: number;
  selected: boolean;
  reordering: boolean;
  /** True when this question's type is wrong for the section subject */
  wrongType: boolean;
  examKind?: string;
  reduceMotion: boolean;
  onSelect: () => void;
  /** ⌥↑ / ⌥↓: one place up or down, saved like a drag. */
  onMove: (delta: -1 | 1) => void;
  rowRef: Ref<HTMLButtonElement>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: q.id,
    transition: reduceMotion ? null : SLIDE,
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: reduceMotion ? undefined : transition,
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    onMove(e.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative flex w-full items-stretch rounded-[12px]",
        // The slot a lifted question left: a soft hole the others slide around.
        isDragging
          ? "border border-dashed border-ms-border-strong bg-ms-surface-2"
          : selected
            ? "bg-ms-primary-soft"
            : "ms-transition hover:bg-ms-surface",
        reordering && "pointer-events-none",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className={cn(
          "flex shrink-0 cursor-grab items-start rounded-l-[12px] pl-2 pr-1 pt-3 text-ms-fg-3 hover:text-ms-fg-2 focus:outline-none active:cursor-grabbing",
          isDragging && "invisible",
        )}
        aria-label="Drag to reorder"
        tabIndex={-1}
      >
        <Icon name="grip" size="sm" />
      </button>
      <button
        type="button"
        ref={rowRef}
        data-qid={q.id}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        aria-current={selected ? "true" : undefined}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        className={cn("flex min-w-0 flex-1 items-start gap-2 rounded-r-[12px] py-2.5 pr-3 text-left", isDragging && "invisible")}
      >
        <RowBody q={q} index={index} examKind={examKind} wrongType={wrongType} />
      </button>
    </div>
  );
}

/** The question under the pointer while it moves: lifted — a touch larger, a deeper shadow. */
export function OutlineGhost({ q, index, examKind, wrongType }: { q: AdminModuleQuestion; index: number; examKind?: string; wrongType: boolean }) {
  return (
    <div className="flex w-full cursor-grabbing items-stretch rounded-[12px] bg-ms-card shadow-ms-2 ring-1 ring-ms-primary/25 motion-safe:animate-ms-lift motion-safe:scale-[1.02]">
      <span className="flex shrink-0 items-start pl-2 pr-1 pt-3 text-ms-fg-2">
        <Icon name="grip" size="sm" />
      </span>
      <span className="flex min-w-0 flex-1 items-start gap-2 py-2.5 pr-3">
        <RowBody q={q} index={index} examKind={examKind} wrongType={wrongType} />
      </span>
    </div>
  );
}

/** What the dots mean, and the keys that move a question. */
export function OutlineLegend() {
  const alt = useModKey() === "⌘" ? "⌥" : "Alt";
  return (
    <div className="flex flex-col gap-2 border-t border-ms-line px-4 py-3 text-[13px] text-ms-fg-2">
      <div className="flex flex-wrap gap-x-3.5 gap-y-1">
        {(["ready", "look", "nokey"] as const).map((v) => (
          <span key={v} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-full", VERDICT[v].dot)} />
            {VERDICT[v].word}
          </span>
        ))}
      </div>
      <span className="inline-flex items-center gap-1 text-ms-fg-3">
        <Kbd>{alt}</Kbd>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        <span className="ml-1">move a question</span>
      </span>
    </div>
  );
}
