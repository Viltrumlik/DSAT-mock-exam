import { cn } from "@/lib/cn";
import type { HTMLAttributes, ReactNode } from "react";

const padMap = { none: "", sm: "p-4", md: "p-5 md:p-6", lg: "p-7 md:p-8" };

export type DashboardAccent = "blue" | "neutral" | "gold";

/**
 * Dashboard card — minimal white/blue design.
 */
export function DashboardCard({
  children,
  className,
  padding = "md",
  interactive = false,
  accent = "blue",
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  padding?: keyof typeof padMap;
  interactive?: boolean;
  accent?: DashboardAccent;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card shadow-sm",
        "transition-[box-shadow,border-color] duration-150",
        interactive && "cursor-pointer hover:border-primary/25 hover:shadow-md",
        padMap[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function DashboardEyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "text-[10px] font-semibold uppercase tracking-[0.12em] text-primary",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function DashboardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-lg font-bold tracking-tight text-foreground md:text-xl", className)}>
      {children}
    </h2>
  );
}
