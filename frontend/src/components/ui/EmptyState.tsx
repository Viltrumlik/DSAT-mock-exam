import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface EmptyStateProps {
  /** Optional — omit for a barer state */
  icon?: LucideIcon;
  /** A rendered mark shown instead of the icon, without the soft chip behind it. */
  media?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /** Tighter padding for inline cards */
  compact?: boolean;
}

/** Flat, encouraging empty state. Copy should be growth-oriented, never punishing. */
export function EmptyState({
  icon: Icon,
  media,
  title,
  description,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-2xl border border-dashed border-border bg-surface-1 text-center",
        compact ? "p-8" : "p-12",
        className,
      )}
    >
      {media ? (
        <div className="mb-4">{media}</div>
      ) : Icon ? (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft">
          <Icon className="h-6 w-6 text-primary" />
        </div>
      ) : null}
      <p className="ds-h4">{title}</p>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
