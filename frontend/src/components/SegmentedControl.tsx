"use client";

/**
 * Compact segmented control (label + pill options). Styled with the classroom/`cr-`
 * design tokens so it sits cleanly inside the homework form's filter rows.
 */
export type SegmentOption = { value: string; label: string };

export function SegmentedControl({
  label,
  value,
  onChange,
  options,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: SegmentOption[];
}) {
  return (
    <div className="flex items-center gap-2">
      {label ? (
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      ) : null}
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface-2/60 p-1">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-primary"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
