"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { AttentionBell } from "@/features/console/AttentionBell";
import type { AttentionSource } from "@/features/console/attention";
import { UserMenu } from "@/features/console/UserMenu";
import { Menu, type MenuItem } from "@/features/console/ui/Menu";
import { cn } from "@/lib/cn";
import type { Crumb, MeLike } from "./opsNav";

/**
 * The bar across the top of the content column (TopBar board, 22 Nov 2026): where you are, then lc-up's two
 * searches — a data search (students, groups, phones) and "Sections ⌘K" (jump to a page) — "+ New", the branch,
 * the week's timetable, the bell and the person. Each is drawn only when it does something for this viewer.
 *
 * White with a hairline under it, sticky. On a phone it keeps the page's name, search, the bell and the person.
 */
export function OpsTopBar({
  crumbs,
  me,
  onOpenSearch,
  onOpenSections,
  attention = [],
  searchLabel,
  newItems = [],
  branch = null,
  timetableHref = null,
}: {
  crumbs: readonly Crumb[];
  me: MeLike;
  /** Opens the data search (students, groups, questions…); `null` when this viewer may search none. */
  onOpenSearch: (() => void) | null;
  /** Opens ⌘K over the console's sections. */
  onOpenSections: () => void;
  /** "Needs you" for the bell; empty for a role that reads none of it (no bell then). */
  attention?: readonly AttentionSource[];
  /** What the data search finds: "Search students, groups, phones". */
  searchLabel: string;
  /** "+ New": the create flows this viewer may start; none → no button. */
  newItems?: MenuItem[];
  /** The branch switcher: its words and menu; `null` → none. */
  branch?: { label: string; items: MenuItem[] } | null;
  /** Where the calendar button goes (the week's timetable); `null` → no button. */
  timetableHref?: string | null;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const last = crumbs[crumbs.length - 1];

  return (
    <header
      data-scrolled={scrolled || undefined}
      className={cn(
        "ms-transition sticky top-0 z-20 flex min-h-(--ms-topbar) shrink-0 items-center gap-1.5 border-b border-ms-border bg-ms-card pl-4 pr-2 sm:gap-2.5 md:px-6",
        scrolled && "shadow-[0_2px_8px_rgba(16,24,40,.06)]",
      )}
    >
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1 lg:flex-none">
        {/* A phone has room for where you are, not the way there. */}
        <p className="truncate text-[19px] font-bold leading-7 tracking-[-.01em] text-ms-fg md:hidden">{last?.label}</p>
        <ol className="hidden min-w-0 items-center gap-1.5 text-[15px] leading-5 md:flex">
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
      <div aria-hidden className="hidden flex-1 lg:block" />

      {onOpenSearch ? (
        <>
          <button
            type="button"
            onClick={onOpenSearch}
            data-search="data"
            className="ms-transition hidden h-10 min-w-[200px] max-w-[420px] flex-[0_1_420px] items-center gap-2.5 rounded-ms-ctl border border-ms-border-strong bg-ms-card px-3 text-[14.5px] text-ms-fg-3 hover:border-ms-border-input lg:flex"
          >
            <Icon name="search" className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">{searchLabel}</span>
          </button>
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label={searchLabel}
            className="ms-transition grid size-11 shrink-0 place-items-center rounded-full text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg lg:hidden"
          >
            <Icon name="search" size="lg" />
          </button>
        </>
      ) : null}

      <button
        type="button"
        onClick={onOpenSections}
        aria-keyshortcuts="Meta+K Control+K"
        aria-label="Jump to a section"
        className="ms-transition hidden h-10 shrink-0 items-center gap-2 rounded-ms-btn border border-ms-border-strong bg-ms-card px-3 text-[14px] font-semibold text-ms-fg hover:bg-ms-surface-2 md:inline-flex"
      >
        <Icon name="grid" size="sm" />
        Sections
        <kbd className="rounded-[5px] border border-ms-border-strong px-1.5 font-ms-mono text-[11.5px] font-medium text-ms-fg-2">⌘K</kbd>
      </button>

      {newItems.length > 0 ? (
        <span className="hidden md:inline-flex">
          <Menu label="Create new" text="New" icon="plus" variant="subtle" items={newItems} />
        </span>
      ) : null}

      {branch ? (
        <span className="hidden xl:inline-flex">
          <Menu label={`Branch: ${branch.label}`} text={branch.label} icon="ms-branch" variant="secondary" items={branch.items} />
        </span>
      ) : null}

      {timetableHref ? (
        <Link
          href={timetableHref}
          aria-label="Timetable of all groups"
          title="Timetable"
          className="ms-transition hidden size-11 shrink-0 place-items-center rounded-full text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg md:grid"
        >
          <Icon name="cal" size="lg" />
        </Link>
      ) : null}

      <AttentionBell sources={attention} />
      <UserMenu me={me} variant="avatar" />
    </header>
  );
}
