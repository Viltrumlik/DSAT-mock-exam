"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type Ref } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Icon } from "@/components/ui/Icon";
import type { AssessmentQuestion } from "@/features/assessments/types";
import { cn } from "@/lib/cn";

/**
 * One question in the set editor's outline (design handoff v0.3, PR 17b), in the module editor's rows: the grip,
 * Q#, its type, Inactive, its first two lines. Dragged, it leaves a soft hole the others slide around; ⌥↑ / ⌥↓
 * moves it with the keyboard. Delete asks on the row (Yes / No) as before.
 */

const TYPE_SHORT: Record<string, string> = {
  multiple_choice: "MC",
  numeric: "Num",
  short_text: "Text",
  boolean: "T/F",
};

/** "Others slide 200 ms" (Motion board), on the console's own curve. */
const SLIDE = { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" };

function RowBody({ q, index, active }: { q: AssessmentQuestion; index: number; active: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-flex h-5 items-center rounded-[6px] px-1.5 text-[12px] font-bold tabular-nums",
            active ? "bg-ms-primary text-white" : "bg-ms-surface-2 text-ms-fg-2",
          )}
        >
          Q{index + 1}
        </span>
        <span className="text-[12px] font-semibold uppercase text-ms-fg-3">{TYPE_SHORT[q.question_type] ?? q.question_type}</span>
        {!q.is_active ? <span className="text-[12px] font-semibold text-ms-attention-fg">Inactive</span> : null}
      </span>
      <span className="line-clamp-2 text-[14px] leading-5 text-ms-fg">
        {q.prompt.trim() || <em className="text-ms-fg-3">No prompt</em>}
      </span>
    </span>
  );
}

export function QuestionRow({
  q,
  index,
  active,
  reordering = false,
  reduceMotion = false,
  onSelect,
  onDelete,
  onMove,
  rowRef,
}: {
  q: AssessmentQuestion;
  index: number;
  active: boolean;
  /** While an order is being saved: the rows hold still. */
  reordering?: boolean;
  reduceMotion?: boolean;
  onSelect: () => void;
  onDelete: () => void;
  /** ⌥↑ / ⌥↓: one place up or down, saved like a drag. */
  onMove?: (delta: -1 | 1) => void;
  rowRef?: Ref<HTMLButtonElement>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: q.id,
    transition: reduceMotion ? null : SLIDE,
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: reduceMotion ? undefined : transition,
  };

  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startConfirm = (e: MouseEvent) => {
    e.stopPropagation();
    setConfirming(true);
    confirmTimer.current = setTimeout(() => setConfirming(false), 4000);
  };
  const cancelConfirm = (e: MouseEvent) => {
    e.stopPropagation();
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
  };
  const commitDelete = (e: MouseEvent) => {
    e.stopPropagation();
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
    onDelete();
  };
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!onMove || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    onMove(e.key === "ArrowUp" ? -1 : 1);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-qid={q.id}
      className={cn(
        "group relative flex w-full items-stretch rounded-[12px]",
        // The slot a lifted question left: a soft hole the others slide around.
        isDragging
          ? "border border-dashed border-ms-border-strong bg-ms-surface-2"
          : active
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
        onClick={onSelect}
        onKeyDown={onKeyDown}
        aria-current={active ? "true" : undefined}
        aria-keyshortcuts={onMove ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-start rounded-[10px] py-2.5 pr-1 text-left focus-visible:outline-2 focus-visible:outline-ms-ring",
          isDragging && "invisible",
        )}
      >
        <RowBody q={q} index={index} active={active} />
      </button>

      {/* Delete: on the row, Yes / No. */}
      <div
        className={cn(
          "ms-transition flex shrink-0 items-start pr-2 pt-2",
          isDragging && "invisible",
          confirming ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
        )}
      >
        {confirming ? (
          <div className="animate-ms-fade-in flex items-center gap-1">
            <button
              type="button"
              onClick={commitDelete}
              className="ms-transition ms-press h-7 rounded-[8px] bg-ms-critical px-2.5 text-[13px] font-semibold text-white hover:brightness-95"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={cancelConfirm}
              className="ms-transition ms-press h-7 rounded-[8px] bg-ms-surface-2 px-2.5 text-[13px] font-semibold text-ms-fg hover:bg-ms-surface-3"
            >
              No
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startConfirm}
            title="Delete question"
            aria-label={`Delete question ${index + 1}`}
            className="ms-transition grid size-7 place-items-center rounded-[8px] text-ms-fg-3 hover:bg-ms-critical-soft hover:text-ms-critical-fg"
          >
            <Icon name="trash" size="sm" className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** The question under the pointer while it moves: lifted — a touch larger, a deeper shadow. */
export function QuestionGhost({ q, index }: { q: AssessmentQuestion; index: number }) {
  return (
    <div className="flex w-full cursor-grabbing items-stretch rounded-[12px] bg-ms-card shadow-ms-2 ring-1 ring-ms-primary/25 motion-safe:animate-ms-lift motion-safe:scale-[1.02]">
      <span className="flex shrink-0 items-start pl-2 pr-1 pt-3 text-ms-fg-2">
        <Icon name="grip" size="sm" />
      </span>
      <span className="flex min-w-0 flex-1 items-start py-2.5 pr-3">
        <RowBody q={q} index={index} active={false} />
      </span>
    </div>
  );
}
