"use client";
import { Trash2 } from "lucide-react";
import type { HighlightPopover as PopoverState } from "./useHighlighter";

interface HighlightPopoverProps {
  popover: PopoverState;
  onRemove: () => void;
}

/** Small "remove highlight" bubble shown when a highlight is clicked. */
export function HighlightPopover({ popover, onRemove }: HighlightPopoverProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className="fixed z-[60] inline-flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white shadow-lg"
      style={{ left: popover.x, top: popover.y - 8 }}
    >
      <Trash2 className="h-3.5 w-3.5" /> Remove highlight
    </button>
  );
}
