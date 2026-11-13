"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { UserMenu } from "@/features/console/UserMenu";
import { usePresence } from "@/features/console/ui/presence";
import { cn } from "@/lib/cn";
import { firstHref, type ConsoleCategory, type ConsoleConfig, type MeLike } from "./opsNav";
import type { Flag } from "./shellModel";

export const RAIL_ID = "ops-rail";

/** A flag's colour = the worst tier inside (Shell board, "Rail item" states). */
export const FLAG_TONE: Record<Flag["tone"], string> = {
  critical: "bg-ms-danger-btn text-white",
  attention: "bg-ms-attention text-[#0f0f10]",
  info: "bg-ms-info text-white",
};

/**
 * The category rail (design handoff v0.4, Shell board): 84 px, ink-black in both themes so it reads as "where", not
 * as content. The logo, the console pill (ADMIN ▾ — the switch moved here from the top bar), one tile per category
 * (icon + label always, never icon-only; the active one a blue tile; a flag with what needs action inside), then
 * Search and the person at the bottom.
 *
 * A tile is a link to the category's first page. The shell decides what hovering, focusing or tapping it does
 * besides (the flyout when the panel is folded, the sheet on a tablet) through `onPeek` / `onTap`.
 *
 * Hidden below 768 px — the phone has the bottom tab bar instead.
 */
export function Rail({
  config,
  categories,
  activeId,
  peekId,
  flags,
  me,
  otherConsole,
  onSearch,
  onPeek,
  onLeave,
  onTap,
}: {
  config: Pick<ConsoleConfig, "root" | "brand" | "crumb">;
  categories: readonly ConsoleCategory[];
  /** The category of the page you are on. */
  activeId: string | null;
  /** The category whose panel floats beside the rail right now, if any. */
  peekId: string | null;
  flags: ReadonlyMap<string, Flag>;
  me: MeLike;
  /** The other console's name and address; `null` when this person may not open it (no ▾ then). */
  otherConsole: { label: string; href: string } | null;
  onSearch: () => void;
  /** Hover or keyboard focus on a tile. */
  onPeek: (id: string, how: "hover" | "focus") => void;
  /** The pointer left the rail. */
  onLeave: () => void;
  /** A tile was clicked or tapped; return `true` to keep the browser from following its link. */
  onTap: (id: string, pointer: string) => boolean;
}) {
  const lastPointer = useRef("mouse");
  return (
    <nav
      id={RAIL_ID}
      aria-label={`${config.crumb} categories`}
      onPointerLeave={onLeave}
      className="fixed inset-y-0 left-0 z-40 hidden w-(--ms-rail) flex-col items-center bg-ms-rail-bg pb-4 pt-3.5 md:flex"
    >
      <Link
        href={config.root}
        aria-label={`MasterSAT ${config.brand}`}
        className="grid size-[46px] shrink-0 place-items-center rounded-[15px] bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7ea6f2]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/logo.png" alt="" aria-hidden className="h-[30px] w-[26px] object-contain" />
      </Link>
      <ConsolePill brand={config.brand} current={config.crumb} other={otherConsole} />

      <ul className="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden [scrollbar-width:none]">
        {categories.map((c) => {
          const on = c.id === activeId;
          const flag = flags.get(c.id);
          return (
            <li key={c.id}>
              <Link
                href={firstHref(c)}
                data-category={c.id}
                aria-current={on ? "true" : undefined}
                aria-expanded={peekId !== null && !c.home ? peekId === c.id : undefined}
                aria-keyshortcuts={`G ${c.letter}`}
                onPointerDown={(e: PointerEvent) => {
                  lastPointer.current = e.pointerType || "mouse";
                }}
                onPointerEnter={(e: PointerEvent) => {
                  if (e.pointerType === "mouse") onPeek(c.id, "hover");
                }}
                onFocus={(e: FocusEvent<HTMLAnchorElement>) => {
                  // Keyboard focus only — a click focuses too, and that is a tap, not a peek.
                  if (e.currentTarget.matches(":focus-visible")) onPeek(c.id, "focus");
                }}
                onClick={(e: MouseEvent) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  if (onTap(c.id, lastPointer.current)) e.preventDefault();
                }}
                className={cn(
                  "group relative flex min-h-[60px] w-[72px] flex-col items-center justify-center gap-[5px] rounded-[16px] text-center text-[12px] font-semibold leading-[14px] outline-none",
                  on ? "text-ms-rail-fg" : "text-ms-rail-fg-2 hover:text-ms-rail-fg",
                )}
              >
                <span
                  className={cn(
                    "grid h-[34px] w-[46px] place-items-center rounded-[13px] transition-colors duration-(--ms-dur-base) ease-ms-out",
                    "group-focus-visible:shadow-[0_0_0_2px_var(--ms-rail-bg),0_0_0_4px_#7ea6f2]",
                    on ? "bg-ms-primary text-white" : peekId === c.id ? "bg-ms-rail-hover text-ms-rail-fg" : "group-hover:bg-ms-rail-hover",
                  )}
                >
                  <Icon name={c.icon} size="lg" />
                </span>
                {c.label}
                {flag ? (
                  <>
                    <span
                      aria-hidden
                      data-flag={flag.tone}
                      className={cn(
                        "absolute right-[14px] top-[5px] grid h-[18px] min-w-[18px] place-items-center rounded-full px-[5px] text-[11px] font-bold leading-none tabular-nums shadow-[0_0_0_2.5px_var(--ms-rail-bg)]",
                        FLAG_TONE[flag.tone],
                      )}
                    >
                      {flag.count}
                    </span>
                    <span className="sr-only">, {flag.count} need you</span>
                  </>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex shrink-0 flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search"
          aria-keyshortcuts="Meta+K Control+K"
          className="group grid min-h-12 w-[72px] place-items-center rounded-[16px] text-ms-rail-fg-2 outline-none hover:text-ms-rail-fg"
        >
          <span className="grid h-[34px] w-[46px] place-items-center rounded-[13px] transition-colors group-hover:bg-ms-rail-hover group-focus-visible:shadow-[0_0_0_2px_var(--ms-rail-bg),0_0_0_4px_#7ea6f2]">
            <Icon name="search" size="lg" />
          </span>
        </button>
        <span aria-hidden className="my-2 h-px w-9 bg-ms-rail-line" />
        <UserMenu me={me} variant="rail" />
      </div>
    </nav>
  );
}

/**
 * ADMIN ▾ (Shell board): the console you are in; its menu opens the other one when this person may (a test admin is
 * kept to the Builder, so they get no ▾). A menu button (WAI-ARIA APG): Escape and a click elsewhere close it.
 */
function ConsolePill({ brand, current, other }: { brand: string; current: string; other: { label: string; href: string } | null }) {
  const [open, setOpen] = useState(false);
  const { mounted, closing } = usePresence(open, 120);
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const pill = "mb-3 mt-1.5 inline-flex h-6 shrink-0 items-center gap-[3px] rounded-full bg-ms-rail-hover px-2 text-[11.5px] font-bold uppercase leading-none tracking-[.02em] text-ms-rail-fg";

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: globalThis.MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!other) return <span className={pill}>{brand}</span>;
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${current} console — switch`}
        onClick={() => setOpen((o) => !o)}
        className={cn(pill, "outline-none hover:bg-white/15 focus-visible:shadow-[0_0_0_2px_#7ea6f2]")}
      >
        {brand}
        <Icon name="down" size="sm" className="size-3" />
      </button>
      {mounted ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Console"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
              button.current?.focus();
            }
          }}
          className={cn(
            closing ? "animate-ms-dialog-out pointer-events-none" : "animate-ms-dialog-in",
            "absolute left-full top-0 z-50 ml-2 w-48 origin-top-left rounded-ms-pop border border-ms-border bg-ms-card p-1.5 text-ms-fg shadow-ms-2",
          )}
        >
          <span role="menuitem" aria-current="true" tabIndex={-1} className="flex min-h-10 items-center gap-2.5 rounded-[8px] px-2.5 text-[15px] font-semibold outline-none focus-visible:bg-ms-surface-2">
            {current}
            <Icon name="check" size="sm" className="ml-auto text-ms-primary-text" />
          </span>
          <a role="menuitem" tabIndex={-1} href={other.href} className="flex min-h-10 items-center gap-2.5 rounded-[8px] px-2.5 text-[15px] text-ms-fg outline-none hover:bg-ms-surface-2 focus-visible:bg-ms-surface-2">
            {other.label}
            <Icon name="switch" size="sm" className="ml-auto text-ms-fg-3" />
          </a>
        </div>
      ) : null}
    </div>
  );
}
