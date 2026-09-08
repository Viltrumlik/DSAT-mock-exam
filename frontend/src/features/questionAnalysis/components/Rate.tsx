import { cn } from "@/lib/cn";
import { EM_DASH, UNKNOWN_RATE_TITLE, formatPercent } from "../format";

/**
 * A percentage, or an honest em dash when there is nothing to divide by.
 *
 * The whole component exists so that no call site can accidentally write `rate ?? 0`. An
 * empty denominator means "we do not know", and rendering that as `0%` tells a teacher the
 * class aced a question nobody has answered — the exact inversion this page must not make.
 * The dash carries a `title` explaining itself, because a bare dash in a column of numbers
 * looks like a rendering bug.
 */
export function RateValue({
  value,
  flagged,
  className,
}: {
  value: number | null | undefined;
  /** At or above the teacher's threshold — worth a lesson. */
  flagged?: boolean;
  className?: string;
}) {
  if (value == null) {
    return (
      <span
        title={UNKNOWN_RATE_TITLE}
        className={cn("cursor-help text-muted-foreground", className)}
      >
        {EM_DASH}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "tabular-nums",
        flagged ? "text-rose-600 dark:text-rose-300" : "text-foreground",
        className,
      )}
    >
      {formatPercent(value)}
    </span>
  );
}
