"use client";

import { cn } from "@/lib/cn";
import type { LucideIcon } from "lucide-react";

/**
 * The house identity masthead — the card with the brand spine that a student meets at the
 * top of a classroom.
 *
 * Lifted 1:1 from `features/classroom/shell/ClassroomShell.tsx:96`, which the school has
 * named as the standard. It lives in the global kit rather than the classroom folder so
 * other pages can wear it without anything in the classroom being touched, and so the
 * device exists once instead of being copied into every page that needs it.
 *
 * Deliberately NOT the generic `PageHeader`: that renders a bare `<h1>` with no frame, and
 * none of the reference areas use it.
 */
export function WorkspaceHeader({
  icon: Icon,
  title,
  description,
  meta,
  actions,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  /** One line under the title. Mutually usable with `meta`. */
  description?: string;
  /** Chips and facts that sit under the title — pills, schedule, role. */
  meta?: React.ReactNode;
  /** Right-hand side: stats, buttons. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "cr-rise flex flex-wrap items-center justify-between gap-4 rounded-[18px] border-b border-l-[5px] border-r border-t-4 border-b-border border-l-primary border-r-border border-t-primary bg-card px-[22px] py-[18px] shadow-[0_6px_16px_rgba(15,23,41,0.06)]",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        {Icon ? (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="h-7 w-7" aria-hidden />
          </div>
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-extrabold tracking-tight text-foreground sm:text-[26px]">
            {title}
          </h1>
          {description || meta ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              {meta}
              {description ? <span className="min-w-0">{description}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </header>
  );
}

/**
 * The page frame the reference areas sit in. Without it a page is full-bleed on a wide
 * monitor while every classroom screen is a centred 72rem column.
 */
export function WorkspaceFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6", className)}>
      {children}
    </div>
  );
}
