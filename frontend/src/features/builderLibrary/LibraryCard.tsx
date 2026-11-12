"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * The Builder library's card (design handoff v0.3, Modern board "Builder library · v0.2 — Tests as a media
 * library", PR 15a): "A cover that shows the test's shape (modules in subject colour), a duration in the
 * corner, title … below — scannable like a video grid." Full mocks use it first; past papers and practice
 * tests follow (PR 15b).
 */

export type CoverTone = "rw" | "math" | "break";

export type CoverBlock = {
  key: string;
  tone: CoverTone;
  /** How wide the block is against the others: a module's question target, the break a sliver. */
  weight: number;
  /** How much of the module is written, 0–1. Undefined = not known (drawn solid). */
  fill?: number;
  /** The second module of a subject is a shade lighter, so the two read as a pair. */
  second?: boolean;
  /** What a pointer hovering it is told, e.g. "Math · Module 1 · 14 / 22 questions · 35 min". */
  title: string;
};

/** "2:24:00": hours, minutes, seconds — a test's length the way a video shows it. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:00`;
}

const SOLID: Record<CoverTone, string> = { rw: "bg-ms-rw", math: "bg-ms-math", break: "bg-ms-surface-3" };
const RING: Record<Exclude<CoverTone, "break">, string> = {
  rw: "shadow-[inset_0_0_0_1.5px_var(--ms-rw)]",
  math: "shadow-[inset_0_0_0_1.5px_var(--ms-math)]",
};

function Block({ block }: { block: CoverBlock }) {
  const base = "relative h-full overflow-hidden rounded-[6px]";
  if (block.tone === "break") return <span title={block.title} className={cn(base, SOLID.break)} />;
  const fill = block.fill;
  // Full (or not known): solid. Started: outlined in its colour, the written part filled. Empty: a grey outline.
  if (fill === undefined || fill >= 1) {
    return <span title={block.title} className={cn(base, SOLID[block.tone], block.second && "opacity-70")} />;
  }
  if (fill <= 0) return <span title={block.title} className={cn(base, "shadow-[inset_0_0_0_1.5px_var(--ms-border-strong)]")} />;
  return (
    <span title={block.title} className={cn(base, RING[block.tone])}>
      <span className={cn("absolute inset-y-0 left-0 opacity-40", SOLID[block.tone])} style={{ width: `${Math.round(fill * 100)}%` }} />
    </span>
  );
}

/**
 * The cover: the test's shape at the bottom, its length in the corner. The whole cover opens the test (a test
 * with nothing to open — no modules yet — gets the cover without the link). `short` is for a grid of two wide
 * cards (a past paper's form, R&W beside Math), where the full height would dwarf the words under it.
 */
export function TestCover({
  blocks,
  minutes,
  href,
  label,
  short = false,
}: {
  blocks: CoverBlock[];
  minutes: number;
  href?: string;
  label: string;
  short?: boolean;
}) {
  const cls = cn(
    "ms-transition group relative block overflow-hidden rounded-[16px] bg-ms-surface-2",
    short ? "aspect-[16/5]" : "aspect-[16/7]",
    href && "hover:bg-ms-surface-3",
  );
  const inside = (
    <>
      <span
        aria-hidden
        className="absolute inset-x-[14px] bottom-[14px] grid h-11 gap-1"
        style={{ gridTemplateColumns: blocks.map((b) => `${Math.max(1, b.weight)}fr`).join(" ") }}
      >
        {blocks.map((b) => (
          <Block key={b.key} block={b} />
        ))}
      </span>
      <span className="absolute right-2.5 top-2.5 rounded-[6px] bg-black/80 px-[7px] py-[3px] text-[12px] font-semibold leading-4 tabular-nums text-white">
        {formatDuration(minutes)}
      </span>
    </>
  );
  return href ? (
    <Link href={href} aria-label={label} className={cls}>
      {inside}
    </Link>
  ) : (
    <div role="img" aria-label={label} className={cls}>
      {inside}
    </div>
  );
}

/**
 * One test in the grid: cover, then its icon, title (a heading, linked when there is something to open), an
 * optional subtitle, a quiet line, its state; then anything the test lists (`body`), a note to read before
 * acting, and what can be done to it.
 */
export function LibraryCard({
  cover,
  icon,
  title,
  href,
  subtitle,
  meta,
  status,
  body,
  note,
  actions,
  delay = 0,
}: {
  cover: ReactNode;
  icon: IconName;
  title: string;
  href?: string;
  /** A line under the title in the card's own words (a practice test's subtitle); kept findable as `data-subtitle`. */
  subtitle?: string;
  meta: ReactNode;
  status: ReactNode;
  /** What the test is made of, e.g. its module links. */
  body?: ReactNode;
  /** A line that needs reading before acting — e.g. why it cannot publish yet. */
  note?: ReactNode;
  actions: ReactNode;
  /** Cards arrive in reading order (ms): the grid's position × a small step. */
  delay?: number;
}) {
  return (
    <article className="animate-ms-card-in flex min-w-0 flex-col gap-3" style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      {cover}
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-ms-card text-ms-fg-2 shadow-ms-1">
          <Icon name={icon} size="md" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="line-clamp-2 text-[16px] font-bold leading-[22px] text-ms-fg">
            {href ? (
              <Link href={href} className="ms-transition hover:text-ms-primary-text">
                {title}
              </Link>
            ) : (
              title
            )}
          </h3>
          {subtitle ? (
            <p data-subtitle className="line-clamp-2 text-[14px] leading-5 text-ms-fg-2">
              {subtitle}
            </p>
          ) : null}
          <span className="text-[13px] leading-[18px] text-ms-fg-3">{meta}</span>
          <span className="flex flex-wrap items-center gap-1.5">{status}</span>
        </div>
      </div>
      {body}
      {note}
      <div className="mt-auto flex flex-wrap items-center gap-1.5">{actions}</div>
    </article>
  );
}

/** The library while it loads: covers and lines in the shimmer. */
export function LibrarySkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid gap-x-[22px] gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="aspect-[16/7] animate-ms-shimmer rounded-[16px] bg-ms-surface-2" />
          <div className="h-4 w-3/4 animate-ms-shimmer rounded-[6px] bg-ms-surface-2" />
          <div className="h-3 w-1/2 animate-ms-shimmer rounded-[6px] bg-ms-surface-2" />
        </div>
      ))}
    </div>
  );
}
