import { cn } from "@/lib/cn";

export type TagTone = "neutral" | "info" | "warning" | "danger";

/**
 * The house `Pill`'s geometry with ink that passes AA in BOTH themes.
 *
 * `Pill`'s tinted tones are readable in dark and short of AA in light, measured on this
 * page's card (`--card` = `#f8fafc`): `info` is 3.48:1 and `danger` 3.72:1 on their own
 * 10% tint, and `warning` is 2.83:1 — all under the 4.5:1 that 12px text needs. The dark
 * variants are fine, so only the light ink moves here.
 *
 * This lives beside the page rather than in `Pill` because `cn()` is a plain join, not
 * tailwind-merge: passing `text-sky-700` alongside `Pill`'s own `text-sky-600` leaves both
 * classes on the element and lets stylesheet order decide the winner. A local component is
 * the only deterministic fix that does not edit the shared kit. The real repair belongs in
 * `features/classroom/ui/Pill.tsx`, where it would fix every page at once.
 *
 * Ratios below are computed against `--card` in each theme, with the 10% tint composited in.
 */
export const TAG_TONES: Record<TagTone, string> = {
  // 6.92:1 light · muted-foreground on surface-2
  neutral: "bg-surface-2 text-muted-foreground",
  // 5.07:1 light · 9.24:1 dark
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  // 6.32:1 light · 10.51:1 dark
  warning: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  // 5.00:1 light · 8.63:1 dark
  danger: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

/** Quiet status chip. Same shape as the house `Pill`, legible ink in light and dark. */
export function Tag({
  tone = "neutral",
  className,
  children,
}: {
  tone?: TagTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TAG_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
