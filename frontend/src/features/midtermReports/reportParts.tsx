import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * The midterm records' notices in the console's look (design handoff v0.3): a standing line in the
 * colour of what it says, always with its icon. Neutral for a fact about the paper, attention for a
 * caveat a reader must not miss, critical for a failure — which is never drawn as an empty list.
 */
export type NoticeTone = "neutral" | "attention" | "critical";

const TONE: Record<NoticeTone, { box: string; icon: IconName }> = {
  neutral: { box: "border-ms-border bg-ms-surface text-ms-fg-2", icon: "info" },
  attention: { box: "border-ms-attention-line bg-ms-attention-soft text-ms-attention-fg", icon: "warn" },
  critical: { box: "border-ms-critical-line bg-ms-critical-soft text-ms-critical-fg", icon: "alert" },
};

export function Notice({
  tone = "neutral",
  icon,
  role,
  children,
  action,
  className,
}: {
  tone?: NoticeTone;
  /** In place of the tone's own icon: the shape that names what this is (a pre-midterm's dashed circle). */
  icon?: IconName;
  role?: "alert" | "status" | "note";
  children: ReactNode;
  /** A button at the end of the line: "Try again". */
  action?: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div
      role={role}
      className={cn("animate-ms-fade-in flex flex-wrap items-start gap-2.5 rounded-ms-ctl border px-3.5 py-2.5 text-[13px] leading-[19px]", t.box, className)}
    >
      <Icon name={icon ?? t.icon} size="sm" className="mt-px size-3.5" />
      <div className="min-w-0 flex-1 basis-[14rem]">{children}</div>
      {action}
    </div>
  );
}
