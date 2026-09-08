import { cn } from "@/lib/cn";
import { EM_DASH, UNKNOWN_RATE_TITLE, formatPercent } from "../format";

/**
 * The ink for a flagged percentage.
 *
 * `text-rose-600` measured 4.31:1 on this page's light card (`--card` = `#f8fafc`) — under
 * the 4.5:1 AA needs, and it is on every flagged number on the page. `rose-700` is 5.79:1
 * there; the dark side already passed at 9.23:1 and is left alone.
 */
export const FLAGGED_RATE_CLASS = "text-rose-700 dark:text-rose-300";

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
  emptyTitle,
  className,
}: {
  value: number | null | undefined;
  /** At or above the teacher's threshold — worth a lesson. */
  flagged?: boolean;
  /**
   * Why *this* denominator is empty, when the default is the wrong reason. A past-paper
   * breakdown whose every question was held out as a likely broken answer key is not waiting
   * on answers — it has them, and cannot trust them — and telling a teacher otherwise sends
   * them to wait for a sitting that already happened.
   */
  emptyTitle?: string;
  className?: string;
}) {
  if (value == null) {
    return (
      <span
        title={emptyTitle ?? UNKNOWN_RATE_TITLE}
        className={cn("cursor-help text-muted-foreground", className)}
      >
        {EM_DASH}
      </span>
    );
  }
  return (
    <span
      className={cn("tabular-nums", flagged ? FLAGGED_RATE_CLASS : "text-foreground", className)}
    >
      {formatPercent(value)}
    </span>
  );
}
