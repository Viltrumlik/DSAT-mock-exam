"use client";

import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { ChipCount, chipClass } from "@/features/console/ui";
import { cn } from "@/lib/cn";

/**
 * The Builder's subject → level drill-down (design handoff v0.3; Assessments PR 17a, Midterms PR 18): the
 * breadcrumb, the subject and level cards, and the filter chips with their counts inside a level.
 */

/** One step of "All subjects › Math › Junior": the earlier steps go back, the last one is where you are. */
export function Crumb({ current, onClick, children }: { current: boolean; onClick?: () => void; children: ReactNode }) {
  return current && !onClick ? (
    <span aria-current="page" className="rounded-[8px] px-2 py-1 font-semibold text-ms-fg">
      {children}
    </span>
  ) : (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? "page" : undefined}
      className={cn(
        "ms-transition rounded-[8px] px-2 py-1 font-semibold hover:bg-ms-surface-2",
        current ? "text-ms-fg" : "text-ms-primary-text",
      )}
    >
      {children}
    </button>
  );
}

/** The breadcrumb's divider. */
export function CrumbSep() {
  return <Icon name="right" size="sm" className="text-ms-fg-3" />;
}

/** A subject's icon square in the Builder's colours: English (R&W) rose with the book, Math violet with Σ. */
export function SubjectSquare({ math }: { math: boolean }) {
  return (
    <span className={cn("grid size-12 shrink-0 place-items-center rounded-[14px]", math ? "bg-ms-math-soft text-ms-math-fg" : "bg-ms-rw-soft text-ms-rw-fg")}>
      <Icon name={math ? "sigma" : "book"} />
    </span>
  );
}

/** A level card's thin bar in its subject's colour. */
export function LevelBar({ math }: { math: boolean }) {
  return <span aria-hidden="true" className={cn("h-9 w-1 shrink-0 rounded-full", math ? "bg-ms-math-fg" : "bg-ms-rw-fg")} />;
}

/** A subject or a level to open: its name and how many are in it. */
export function BucketCard({
  lead,
  title,
  sub,
  big = false,
  dashed = false,
  delay = 0,
  onClick,
}: {
  lead?: ReactNode;
  title: string;
  sub: string;
  big?: boolean;
  dashed?: boolean;
  delay?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "group animate-ms-card-in ms-hover-lift ms-press flex items-center justify-between gap-4 rounded-ms-card text-left",
        big ? "p-6" : "p-5",
        dashed ? "border border-dashed border-ms-border-strong bg-transparent" : "bg-ms-card shadow-ms-1",
      )}
    >
      <span className="flex min-w-0 items-center gap-4">
        {lead}
        <span className="min-w-0">
          <span className={cn("block font-bold text-ms-fg", big ? "text-[18px] leading-6" : "text-[16px] leading-[22px]")}>{title}</span>
          <span className="mt-0.5 block text-[14px] text-ms-fg-2">{sub}</span>
        </span>
      </span>
      <Icon name="right" className="shrink-0 text-ms-fg-3 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

/** A filter as chips with their counts in this level. */
export function ChipGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { v: T; l: string; n: number }[];
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {options.map((o, i) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={chipClass(value === o.v, o.n === 0 && i > 0)}
        >
          {o.l}
          <ChipCount n={o.n} on={value === o.v} />
        </button>
      ))}
    </div>
  );
}
