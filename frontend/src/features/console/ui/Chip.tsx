"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * A quick filter in the chip bar (Controls board): filled grey, the chosen one inverted. A choice
 * with nothing in it stays visible but greyed, so the bar never changes shape under the finger.
 */
export function chipClass(on: boolean, zero = false): string {
  return cn(
    "ms-press inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ms-chip px-3 text-[14px] leading-none",
    on
      ? "bg-ms-chip-on-bg font-semibold text-ms-chip-on-fg"
      : zero
        ? "font-medium text-ms-fg-disabled shadow-[inset_0_0_0_1px_var(--ms-border-strong)]"
        : "bg-ms-surface-2 font-medium text-ms-fg hover:bg-ms-surface-3",
  );
}

/** The number on a chip or a filter choice. */
export function ChipCount({ n, on = false }: { n: number; on?: boolean }) {
  return <span className={cn("text-[13px] tabular-nums", on ? "opacity-75" : "text-ms-fg-3")}>{n.toLocaleString("en-US")}</span>;
}

/**
 * A filter in force, "Branch: Chilonzor", with its own ×. The value after ": " is bold. Keeps the
 * `data-filter-chip` hook and the "Remove <label>" name the SMS journal's tests know it by.
 */
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const colon = label.indexOf(": ");
  return (
    <span
      data-filter-chip
      className="animate-ms-fade-in inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-ms-primary-soft pl-3 pr-[3px] text-[13px] leading-none text-ms-primary-text"
    >
      {colon > 0 ? (
        <>
          {label.slice(0, colon + 2)}
          <b className="font-semibold">{label.slice(colon + 2)}</b>
        </>
      ) : (
        label
      )}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="ms-press grid size-[26px] place-items-center rounded-full hover:bg-ms-primary-soft-2"
      >
        <Icon name="x" size="sm" />
      </button>
    </span>
  );
}
