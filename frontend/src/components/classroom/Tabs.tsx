import { cn } from "@/lib/cn";
import type { LucideIcon } from "lucide-react";

export type ClassroomTabItem = {
  id: string;
  label: string;
  icon?: LucideIcon;
};

export function ClassroomTabs({
  items,
  value,
  onChange,
  className,
  ariaLabel = "Section navigation",
}: {
  items: ClassroomTabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex flex-wrap gap-2 rounded-2xl border border-border bg-surface-2/90 p-1.5",
        className,
      )}
    >
      {items.map(({ id, label, icon: Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            id={`classroom-tab-${id}`}
            aria-controls={`classroom-panel-${id}`}
            onClick={() => onChange(id)}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-all duration-200 ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            {Icon ? <Icon className="h-4 w-4 shrink-0 opacity-85" strokeWidth={2} /> : null}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
