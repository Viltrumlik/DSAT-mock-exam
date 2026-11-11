import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/** The six verdicts, plus neutral and an outline for a fact that is no verdict (design handoff v0.3, rule 3). */
export type BadgeTone = "positive" | "attention" | "critical" | "info" | "frozen" | "neutral" | "line";

const TONE: Record<BadgeTone, string> = {
  positive: "bg-ms-positive-soft text-ms-positive-fg",
  attention: "bg-ms-attention-soft text-ms-attention-fg",
  critical: "bg-ms-critical-soft text-ms-critical-fg",
  info: "bg-ms-info-soft text-ms-info-fg",
  frozen: "bg-ms-frozen-soft text-ms-frozen-fg",
  neutral: "bg-ms-neutral-soft text-ms-neutral-fg",
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
}: {
  tone?: BadgeTone;
  icon?: IconName;
  dot?: boolean;
  size?: "md" | "lg";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold leading-none",
        size === "lg" ? "h-7 px-[11px] text-[14px]" : "h-6 px-[9px] text-[13px]",
        TONE[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" /> : icon ? <Icon name={icon} size="sm" className="size-3.5 shrink-0" /> : null}
      {children}
    </span>
  );
}
