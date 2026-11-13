"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { AttentionBell } from "@/features/console/AttentionBell";
import type { AttentionSource } from "@/features/console/attention";
import { UserMenu } from "@/features/console/UserMenu";
import { cn } from "@/lib/cn";
import type { Crumb, MeLike } from "./opsNav";
import { MAX_PINS } from "./shellStore";

/**
 * The bar across the top of the content column (design handoff v0.4, Shell board): the breadcrumb in the shell's
 * three levels (Centre › Finance › Debtors — every step but the last is a link), the ⌘K search pill, the bookmark
 * that pins this page, and the attention bell. The console switch and the person moved into the rail.
 *
 * Flat at the top of the page; once content scrolls under it a hairline and a soft shadow show the edge. On a phone
 * (no rail) it keeps the page's name, search, the bell and the person, each 44 × 44.
 */
export function OpsTopBar({
  crumbs,
  me,
  onOpenSearch,
  attention = [],
  searchLabel = "Search pages…",
  pin,
}: {
  crumbs: readonly Crumb[];
  me: MeLike;
  /** Opens ⌘K. */
  onOpenSearch: () => void;
  /** "Needs you" for the bell; empty for a role that reads none of it (no bell then). */
  attention?: readonly AttentionSource[];
  /** What the pill says ⌘K searches here: "Search students, classes, pages…". */
  searchLabel?: string;
  /** This page's bookmark: whether it is pinned, how many pins there are, and the toggle. */
  pin: { pinned: boolean; count: number; onToggle: () => void } | null;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const last = crumbs[crumbs.length - 1];
  const full = pin ? !pin.pinned && pin.count >= MAX_PINS : false;

  return (
    <header
      data-scrolled={scrolled || undefined}
      className={cn(
        "ms-transition sticky top-0 z-20 flex h-(--ms-topbar) shrink-0 items-center gap-1.5 border-b bg-ms-bg pl-4 pr-2 sm:gap-3 md:px-6",
        scrolled ? "border-ms-border shadow-[0_4px_12px_rgba(0,0,0,.06)]" : "border-transparent",
      )}
    >
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        {/* A phone has room for where you are, not the way there. */}
        <p className="truncate text-[20px] font-extrabold leading-7 tracking-[-.02em] text-ms-fg md:hidden">{last?.label}</p>
        <ol className="hidden min-w-0 items-center gap-1.5 text-[14px] leading-5 md:flex">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <Fragment key={`${i}-${c.label}`}>
                {i > 0 ? (
                  <li aria-hidden className="shrink-0 text-ms-fg-3">
                    <Icon name="right" size="sm" />
                  </li>
                ) : null}
                <li className={cn(isLast ? "min-w-0 truncate" : "shrink-0")}>
                  {isLast || !c.href ? (
                    <span aria-current={isLast ? "page" : undefined} className={cn(isLast ? "font-semibold text-ms-fg" : "font-medium text-ms-fg-3")}>
                      {c.label}
                    </span>
                  ) : (
                    <Link href={c.href} className="ms-transition rounded-[6px] font-medium text-ms-fg-3 hover:text-ms-fg">
                      {c.label}
                    </Link>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-keyshortcuts="Meta+K Control+K"
        className="ms-transition hidden h-[42px] w-[min(340px,30vw)] items-center gap-2.5 rounded-full border border-ms-border-strong bg-ms-card pl-4 pr-2 text-[15px] text-ms-fg-3 hover:border-ms-border-input md:flex"
      >
        <Icon name="search" />
        <span className="flex-1 truncate text-left">{searchLabel}</span>
        <kbd className="rounded-[6px] border border-ms-border-strong px-1.5 font-ms-mono text-[12px] text-ms-fg-2">⌘ K</kbd>
      </button>
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Search"
        className="ms-transition grid size-11 shrink-0 place-items-center rounded-full text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg md:hidden"
      >
        <Icon name="search" size="lg" />
      </button>

      {pin ? (
        <span className="relative hidden md:inline-flex">
          <button
            type="button"
            onClick={pin.onToggle}
            aria-pressed={pin.pinned}
            aria-disabled={full || undefined}
            aria-describedby={full ? "ops-pin-full" : undefined}
            aria-label={pin.pinned ? "Pinned — unpin this page" : "Pin this page"}
            title={full ? `Up to ${MAX_PINS} pins — unpin one first` : pin.pinned ? "Pinned — unpin this page" : "Pin this page"}
            className={cn(
              "ms-transition grid size-11 shrink-0 place-items-center rounded-full hover:bg-ms-surface-2",
              pin.pinned ? "text-ms-primary-text" : "text-ms-fg-2 hover:text-ms-fg",
              full && "cursor-not-allowed opacity-50 hover:bg-transparent",
            )}
          >
            <Icon name="bookmark" size="lg" className={pin.pinned ? "fill-current" : undefined} />
          </button>
          {full ? (
            <span id="ops-pin-full" className="sr-only">
              Up to {MAX_PINS} pins — unpin one first
            </span>
          ) : null}
        </span>
      ) : null}

      <AttentionBell sources={attention} />
      <div className="md:hidden">
        <UserMenu me={me} />
      </div>
    </header>
  );
}
