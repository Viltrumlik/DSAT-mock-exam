"use client";

import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/** A ghost button on the bar's inverse ground; its hover is a tint of its own colour, so it shows in light and dark. */
export const bulkButtonClass =
  "ms-press inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ms-btn px-3 text-[14px] font-semibold text-ms-inverse-fg " +
  "hover:bg-[color-mix(in_srgb,currentColor_14%,transparent)] disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The bulk bar (DataDisplay board): it rises in at the bottom of the screen once a row is ticked,
 * says how many, and holds the actions for the ticked rows and an × that clears them.
 */
export function BulkBar({ count, onClear, children, closing = false }: { count: number; onClear: () => void; children: ReactNode; closing?: boolean }) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className={cn(closing ? "animate-ms-sink-out pointer-events-none" : "animate-ms-rise-in pointer-events-auto", "flex min-h-14 max-w-full flex-wrap items-center gap-1 rounded-[28px] bg-ms-inverse-bg py-2 pl-5 pr-2 text-ms-inverse-fg shadow-ms-2")}
    >
      <b aria-live="polite" className="text-[15px] tabular-nums">
        {count} selected
      </b>
      <span aria-hidden="true" className="mx-1.5 h-6 w-px bg-[rgba(127,127,127,.4)]" />
      {children}
      <button type="button" aria-label="Clear selection" onClick={onClear} className={cn(bulkButtonClass, "w-9 justify-center px-0")}>
        <Icon name="x" size="sm" />
      </button>
    </div>
  );
}
