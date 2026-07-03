"use client";

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import type { AssessmentQuestion } from "@/features/assessments/types";
import { cn } from "@/lib/cn";

const TYPE_SHORT: Record<string, string> = {
  multiple_choice: "MC",
  numeric: "Num",
  short_text: "Text",
  boolean: "T/F",
};

// ─── Sortable question row ────────────────────────────────────────────────────

export function QuestionRow({
  q,
  index,
  active,
  onSelect,
  onDelete,
}: {
  q: AssessmentQuestion;
  index: number;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: q.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(true);
    confirmTimer.current = setTimeout(() => setConfirming(false), 4000);
  };
  const cancelConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
  };
  const commitDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
    onDelete();
  };
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={cn(
        "group flex items-start gap-2 rounded-xl border px-3 py-2.5 cursor-pointer transition-all",
        active
          ? "border-primary/40 bg-primary/8 shadow-sm"
          : "border-border bg-card hover:border-border/80 hover:bg-surface-2/60",
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5 cursor-grab text-muted-foreground/30 hover:text-muted-foreground active:cursor-grabbing shrink-0"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* Number + content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={cn(
            "text-[9px] font-black uppercase tabular-nums rounded px-1 py-0.5",
            active ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted-foreground",
          )}>
            Q{index + 1}
          </span>
          <span className="text-[9px] font-bold text-muted-foreground/60 uppercase">
            {TYPE_SHORT[q.question_type] ?? q.question_type}
          </span>
          {!q.is_active && (
            <span className="text-[9px] font-bold text-amber-600 uppercase">Inactive</span>
          )}
        </div>
        <p className="text-xs font-semibold leading-snug text-foreground line-clamp-2">
          {q.prompt.trim() || <em className="text-muted-foreground/40 font-normal">No prompt</em>}
        </p>
      </div>

      {/* Delete */}
      <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {confirming ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={commitDelete}
              className="rounded-lg bg-red-500 px-2 py-1 text-[10px] font-black text-white hover:bg-red-600"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={cancelConfirm}
              className="rounded-lg border border-border bg-card px-2 py-1 text-[10px] font-bold hover:bg-surface-2"
            >
              No
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startConfirm}
            className="rounded-lg p-1 text-muted-foreground/40 hover:bg-red-50 hover:text-red-500 transition-colors"
            title="Delete question"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
