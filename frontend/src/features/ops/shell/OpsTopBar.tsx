"use client";

import { useEffect, useState, type RefObject } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { UserMenu } from "@/features/console/UserMenu";
import { cn } from "@/lib/cn";
import { OPS_SIDEBAR_ID } from "./OpsSidebar";
import { OPS_CONSOLE, sectionFor, type ConsoleConfig, type MeLike } from "./opsNav";

/**
 * The bar across the top of the content column (design handoff v0.3, Shell board): the menu button
 * (below `lg`), where you are ("Admin › Students" — back is always the parent crumb), the ⌘K search
 * pill, the Admin | Builder switch, and the person with their menu.
 *
 * Flat at the top of the page; once content scrolls under it a hairline and a soft shadow show the
 * edge. On a phone it keeps the page title, a search button and the avatar, each 44 × 44.
 */
export function OpsTopBar({
  pathname,
  me,
  mobileOpen,
  onOpenMobile,
  menuButtonRef,
  onOpenSearch,
  otherConsole,
  config = OPS_CONSOLE,
}: {
  pathname: string;
  me: MeLike;
  mobileOpen: boolean;
  onOpenMobile: () => void;
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
  /** Opens ⌘K. */
  onOpenSearch: () => void;
  /** The other console's name and address, for the switch. */
  otherConsole: { label: string; href: string };
  /** Which console this bar belongs to — its home, its first crumb, its nav. */
  config?: Pick<ConsoleConfig, "root" | "crumb" | "groups">;
}) {
  const [scrolled, setScrolled] = useState(false);
  const section = sectionFor(pathname, config.groups, config.root);
  const atSection = section ? pathname === section.href : false;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-scrolled={scrolled || undefined}
      className={cn(
        "ms-transition sticky top-0 z-20 flex h-(--ms-topbar) shrink-0 items-center gap-1.5 border-b bg-ms-bg px-2 sm:gap-3 md:px-6",
        scrolled ? "border-ms-border shadow-[0_4px_12px_rgba(0,0,0,.06)]" : "border-transparent",
      )}
    >
      <button
        ref={menuButtonRef}
        type="button"
        onClick={onOpenMobile}
        aria-label="Open menu"
        aria-controls={OPS_SIDEBAR_ID}
        aria-expanded={mobileOpen}
        className="ms-transition grid size-11 shrink-0 place-items-center rounded-full text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg lg:hidden"
      >
        <Icon name="menu" size="lg" />
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-[14px] leading-5">
          <li className={cn("shrink-0", section && "max-sm:hidden")}>
            <Link href={config.root} className="ms-transition rounded-[6px] font-medium text-ms-fg-3 hover:text-ms-fg">
              {config.crumb}
            </Link>
          </li>
          {section ? (
            <>
              <li aria-hidden className="shrink-0 text-ms-fg-3 max-sm:hidden">
                <Icon name="right" size="sm" />
              </li>
              <li className="min-w-0 truncate">
                {atSection ? (
                  <span aria-current="page" className="font-semibold text-ms-fg max-sm:text-[16px]">
                    {section.label}
                  </span>
                ) : (
                  <Link href={section.href} className="ms-transition rounded-[6px] font-semibold text-ms-fg hover:underline max-sm:text-[16px]">
                    {section.label}
                  </Link>
                )}
              </li>
            </>
          ) : null}
        </ol>
      </nav>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-keyshortcuts="Meta+K Control+K"
        className="ms-transition hidden h-[42px] w-[min(340px,30vw)] items-center gap-2.5 rounded-full border border-ms-border-strong bg-ms-card pl-4 pr-2 text-[15px] text-ms-fg-3 hover:border-ms-border-input md:flex"
      >
        <Icon name="search" />
        <span className="flex-1 truncate text-left">Search pages…</span>
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

      <div role="group" aria-label="Console" className="hidden shrink-0 items-center gap-0.5 rounded-full bg-ms-surface-2 p-[3px] lg:inline-flex">
        <span aria-current="page" className="inline-flex h-9 items-center rounded-full bg-ms-card px-3.5 text-[14px] font-semibold text-ms-fg shadow-ms-1">
          {config.crumb}
        </span>
        <a href={otherConsole.href} className="ms-transition inline-flex h-9 items-center rounded-full px-3.5 text-[14px] font-medium text-ms-fg-2 hover:text-ms-fg">
          {otherConsole.label}
        </a>
      </div>

      <UserMenu me={me} />
    </header>
  );
}
