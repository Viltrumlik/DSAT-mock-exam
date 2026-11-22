import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/** The six verdicts, plus neutral and an outline for a fact that is no verdict (design handoff v0.3, rule 3). */
export type BadgeTone = "positive" | "attention" | "critical" | "info" | "frozen" | "neutral" | "line";

const TONE: Record<BadgeTone, string> = {
  // A hairline in the verdict's own hue keeps the pill readable on a tinted cell (v0.7 "calm vivid").
  positive: "bg-ms-positive-soft text-ms-positive-fg shadow-[inset_0_0_0_1px_var(--ms-positive-line)]",
  attention: "bg-ms-attention-soft text-ms-attention-fg shadow-[inset_0_0_0_1px_var(--ms-attention-line)]",
  critical: "bg-ms-critical-soft text-ms-critical-fg shadow-[inset_0_0_0_1px_var(--ms-critical-line)]",
  info: "bg-ms-info-soft text-ms-info-fg shadow-[inset_0_0_0_1px_var(--ms-info-line)]",
  frozen: "bg-ms-frozen-soft text-ms-frozen-fg shadow-[inset_0_0_0_1px_var(--ms-frozen-line)]",
  neutral: "bg-ms-neutral-soft text-ms-neutral-fg shadow-[inset_0_0_0_1px_var(--ms-neutral-line)]",
  line: "bg-transparent text-ms-fg-2 shadow-[inset_0_0_0_1px_var(--ms-border-strong)]",
};

/** A verdict as a pill: always an icon (or a dot) AND a word, never colour alone. */
export function Badge({
  tone = "neutral",
  icon,
  dot = false,
  size = "md",
  children,
  className,
  iconClassName,
}: {
  tone?: BadgeTone;
  icon?: IconName;
  dot?: boolean;
  size?: "md" | "lg";
  children: ReactNode;
  className?: string;
  /** Motion for the icon, e.g. the snowflake turning in when a status becomes Frozen. */
  iconClassName?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-ms-badge font-semibold leading-none",
        size === "lg" ? "h-7 px-[11px] text-[14px]" : "h-6 px-[9px] text-[13px]",
        TONE[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" /> : icon ? <Icon name={icon} size="sm" className={cn("size-3.5 shrink-0", iconClassName)} /> : null}
      {children}
    </span>
  );
}
