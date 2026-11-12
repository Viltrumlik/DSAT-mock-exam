"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * A 20 px box (Controls board) over a real checkbox that covers a 40 px square, so the finger has
 * room and the label, focus and keyboard are the browser's own. `indeterminate` is "some ticked".
 */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  const on = checked || indeterminate;
  return (
    <span className="relative -m-2.5 inline-grid size-10 shrink-0 place-items-center">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        className="peer absolute inset-0 z-[1] m-0 cursor-pointer appearance-none rounded-[10px] focus-visible:outline-none disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={cn(
          "ms-transition grid size-5 place-items-center rounded-[6px] border-[1.5px] text-white",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ms-ring",
          disabled ? "border-ms-border bg-ms-surface-2" : on ? "border-ms-primary bg-ms-primary" : "border-ms-border-input bg-ms-card",
        )}
      >
        {on ? <Icon name={indeterminate ? "minus" : "check"} size="sm" className="animate-ms-check-pop size-3.5" /> : null}
      </span>
    </span>
  );
}
