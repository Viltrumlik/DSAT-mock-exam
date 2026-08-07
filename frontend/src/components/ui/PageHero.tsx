"use client";

import { cn } from "@/lib/cn";
import type { LucideIcon } from "lucide-react";

/**
 * The blue masthead a student meets at the top of a homework, with its badge row, oversized
 * title and row of facts.
 *
 * Lifted from `features/classroom/pages/AssignmentDetail.tsx`, which the school named as the
 * standard, and put in the global kit so a page can wear it without importing anything from
 * the classroom. It exists once here rather than being copied into each page, because the
 * whole point of the school's request is that these surfaces agree with each other.
 *
 * The reference's padding is fixed at 34px, which on a phone leaves the title almost no room;
 * the values below match it from `sm` up and step down under it.
 */
export function PageHero({
  badge,
  icon: Icon,
  title,
  description,
  tiles = [],
  actions,
  children,
  className,
}: {
  /** Small chip above the title — the kind of thing this page is. */
  badge?: React.ReactNode;
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** The reference's fact row: a label above a value. One may be highlighted. */
  tiles?: { label: string; value: React.ReactNode; accent?: boolean; icon?: LucideIcon }[];
  /** Right-hand side, top-aligned with the badge row. */
  actions?: React.ReactNode;
  /** Anything that belongs inside the blue, under the tiles. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-gradient-to-br from-primary to-primary-hover px-6 py-7 text-primary-foreground sm:px-[34px] sm:py-[30px]",
        className,
      )}
    >
      {/* The reference's soft orb, bottom-right. Decorative only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-12 -right-8 h-52 w-52 rounded-full bg-white/[0.06]"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {Icon ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
          ) : null}
          {badge ? (
            <span className="inline-flex items-center rounded-[20px] bg-white/20 px-[13px] py-[5px] text-xs font-extrabold">
              {badge}
            </span>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      <h1 className="relative my-[14px] text-[28px] font-extrabold leading-none tracking-[-0.025em] sm:text-[34px]">
        {title}
      </h1>
      {description ? (
        <p className="relative -mt-1 mb-[18px] max-w-2xl text-[15px] font-medium opacity-[0.86]">
          {description}
        </p>
      ) : null}

      {tiles.length > 0 ? (
        <div className="relative flex flex-wrap gap-x-8 gap-y-4 sm:gap-x-[34px]">
          {tiles.map((t, i) => (
            <div key={t.label} className="cr-pillin" style={{ animationDelay: `${i * 60}ms` }}>
              <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] opacity-[0.72]">
                {t.label}
              </div>
              {t.accent ? (
                <div className="cr-daypop mt-[5px] inline-flex items-center gap-1.5 rounded-lg bg-white/[0.16] px-[11px] py-[3px] text-[15px] font-extrabold">
                  {t.icon ? <t.icon className="h-3.5 w-3.5" aria-hidden /> : null}
                  {t.value}
                </div>
              ) : (
                <div className="mt-[3px] flex items-center gap-1.5 text-[17px] font-extrabold">
                  {t.icon ? <t.icon className="h-4 w-4 opacity-80" aria-hidden /> : null}
                  {t.value}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {children ? <div className="relative">{children}</div> : null}
    </div>
  );
}

/**
 * The page wrapper the reference uses: a centred column set in the house's display face.
 * `AssignmentDetail` sets the family inline on its own root — that is where this comes from,
 * and doing it once here is what stops each page inventing its own.
 */
export function HeroPage({
  children,
  width = "wide",
  className,
}: {
  children: React.ReactNode;
  /** `narrow` matches the homework detail's 48rem reading column; `wide` the classroom's. */
  width?: "narrow" | "wide";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 pb-16 pt-4 sm:px-6",
        width === "narrow" ? "max-w-3xl" : "max-w-6xl",
        className,
      )}
      style={{ fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" }}
    >
      {children}
    </div>
  );
}
