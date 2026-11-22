"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { usePresence } from "@/features/console/ui/presence";
import { cn } from "@/lib/cn";
import { isOpsNavActive, type ConsoleCategory, type ConsoleConfig, type OpsNavItem } from "./opsNav";

export const SIDEBAR_ID = "ops-sidebar";

/** The default tile hue for an item that names none: the brand blue. */
const DEFAULT_TONE = "#2a68c0";

/** Page href → the verdict count drawn beside it (Today's "Needs you", Finance's debtors). */
export type SidebarCounts = ReadonlyMap<string, number>;

/**
 * The console's one-level sidebar (lc-up structure canvas, 22 Nov 2026, Rail board option A — the owner's pick
 * after the v0.4 dark rail + second panel was not liked): 248 px, light, words always; sections captioned (Today,
 * Daily work, Teaching, Centre, Content, People & system); every page a row with a small solid icon tile in its own
 * hue; a count only where a verdict waits. It folds to 76 px icons (remembered), and is folded on a tablet. A phone
 * has the bottom tabs instead.
 */
export function Sidebar({
  config,
  categories,
  pathname,
  activeHref,
  counts,
  folded,
  canFold,
  onToggleFold,
  otherConsole,
}: {
  config: Pick<ConsoleConfig, "root" | "crumb">;
  /** The sections this viewer may open, in order. */
  categories: readonly ConsoleCategory[];
  pathname: string;
  /** The item the page sits under (longest match), lit as the current page. */
  activeHref: string | null;
  counts: SidebarCounts;
  /** Icons only. */
  folded: boolean;
  /** Whether the person may fold / unfold it here (not on a tablet, where it is always folded). */
  canFold: boolean;
  onToggleFold: () => void;
  /** The other console's name and address; `null` when this person may not open it. */
  otherConsole: { label: string; href: string } | null;
}) {
  return (
    <nav
      id={SIDEBAR_ID}
      aria-label={`${config.crumb} sections`}
      data-folded={folded || undefined}
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-ms-border bg-ms-card md:flex",
        "transition-[width] duration-200 ease-ms-out",
        folded ? "w-(--ms-side-folded)" : "w-(--ms-side)",
      )}
    >
      <Brand config={config} folded={folded} otherConsole={otherConsole} />

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-3 pb-3 [scrollbar-width:thin]">
        {categories.map((c) => {
          const items = c.groups.flatMap((g) => g.items).filter((i) => !i.hidden);
          if (items.length === 0) return null;
          return (
            <Fragment key={c.id}>
              {c.home ? null : folded ? (
                <div aria-hidden className="mx-auto my-2 h-px w-9 shrink-0 bg-ms-border" />
              ) : (
                <div className="shrink-0 px-2.5 pb-1.5 pt-3.5 text-[12px] font-semibold uppercase leading-4 tracking-[.04em] text-ms-fg-3">
                  {c.label}
                </div>
              )}
              {items.map((item) => (
                <SidebarItem
                  key={item.href}
                  item={item}
                  active={item.href === activeHref || (activeHref === null && isOpsNavActive(pathname, item))}
                  count={counts.get(item.href) ?? 0}
                  folded={folded}
                />
              ))}
            </Fragment>
          );
        })}
      </div>

      {canFold ? (
        <div className="shrink-0 border-t border-ms-border px-3 py-2.5">
          <button
            type="button"
            onClick={onToggleFold}
            aria-keyshortcuts="["
            aria-label={folded ? "Expand the sidebar" : "Collapse the sidebar"}
            title={folded ? "Expand ( [ )" : "Collapse ( [ )"}
            className={cn(
              "ms-transition flex min-h-10 w-full items-center gap-3 rounded-[9px] px-2.5 text-[14px] font-medium text-ms-fg-3 hover:bg-ms-surface-2 hover:text-ms-fg",
              folded && "justify-center px-0",
            )}
          >
            <Icon name="panel" className={cn("shrink-0", folded && "rotate-180")} />
            {folded ? null : <span>Collapse</span>}
          </button>
        </div>
      ) : null}
    </nav>
  );
}

function SidebarItem({ item, active, count, folded }: { item: OpsNavItem; active: boolean; count: number; folded: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={folded ? (count > 0 ? `${item.label}, ${count}` : item.label) : undefined}
      title={folded ? item.label : undefined}
      data-nav-item={item.href}
      className={cn(
        "ms-transition relative flex shrink-0 items-center gap-3 rounded-[9px] text-[15px] leading-[18px] outline-none focus-visible:shadow-[0_0_0_2px_var(--ms-ring)]",
        item.main ? "min-h-[42px]" : "min-h-9",
        folded ? "justify-center px-0" : "px-2.5 py-[3px]",
        active ? "bg-ms-primary-soft font-semibold text-ms-primary-text" : "font-medium text-ms-fg hover:bg-ms-surface-2",
      )}
    >
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-[8px] text-white"
        style={{ backgroundColor: item.tone ?? DEFAULT_TONE }}
      >
        <Icon name={item.icon} size="sm" className="size-4" />
      </span>
      {folded ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {count > 0 ? (
        <span
          data-nav-count
          className={cn(
            "grid h-5 min-w-5 place-items-center rounded-full bg-ms-danger-btn px-1.5 text-[11.5px] font-bold tabular-nums leading-none text-white",
            folded && "absolute right-1.5 top-0.5 h-[18px] min-w-[18px] text-[11px] shadow-[0_0_0_2px_var(--ms-card)]",
          )}
        >
          {count > 999 ? "999+" : count}
        </span>
      ) : null}
    </Link>
  );
}

/** The logo and the console's name; the name is the switch to the other console when this person may open it. */
function Brand({
  config,
  folded,
  otherConsole,
}: {
  config: Pick<ConsoleConfig, "root" | "crumb">;
  folded: boolean;
  otherConsole: { label: string; href: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const { mounted, closing } = usePresence(open, 120);
  const menuId = useId();
  const box = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const words = (
    <span className="flex min-w-0 flex-col">
      <span className="text-[15px] font-bold leading-[18px] text-ms-fg">MasterSAT</span>
      <span className="text-[13px] leading-4 text-ms-fg-3">{config.crumb}</span>
    </span>
  );

  return (
    <div ref={box} className={cn("relative flex shrink-0 items-center gap-2.5 px-[18px] pb-3.5 pt-4", folded && "justify-center px-0")}>
      {/* The centre's own shield, as the student app shows it (owner, 22 Nov 2026: "bu yerda logo tursin M o'rnida"). */}
      <Link
        href={config.root}
        aria-label={`MasterSAT ${config.crumb} — home`}
        data-brand-logo
        className="grid h-9 shrink-0 place-items-center rounded-[8px] outline-none focus-visible:shadow-[0_0_0_2px_var(--ms-ring)]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/logo.png" alt="" width={434} height={500} className="h-9 w-auto object-contain" />
      </Link>
      {folded ? null : otherConsole ? (
        <button
          ref={button}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={`${config.crumb} console — switch`}
          onClick={() => setOpen((o) => !o)}
          className="ms-transition -ml-1 flex min-w-0 items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-left hover:bg-ms-surface-2"
        >
          {words}
          <Icon name="down" size="sm" className="shrink-0 text-ms-fg-3" />
        </button>
      ) : (
        words
      )}
      {mounted && otherConsole ? (
        <div
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
            "absolute left-4 top-full z-50 w-52 origin-top-left rounded-ms-pop border border-ms-border-strong bg-ms-card p-1.5 text-ms-fg shadow-ms-2",
          )}
        >
          <span role="menuitem" aria-current="true" tabIndex={-1} className="flex min-h-10 items-center gap-2.5 rounded-[7px] px-2.5 text-[15px] font-semibold outline-none">
            {config.crumb}
            <Icon name="check" size="sm" className="ml-auto text-ms-primary-text" />
          </span>
          <a role="menuitem" href={otherConsole.href} className="flex min-h-10 items-center gap-2.5 rounded-[7px] px-2.5 text-[15px] text-ms-fg outline-none hover:bg-ms-surface-2 focus-visible:bg-ms-surface-2">
            {otherConsole.label}
            <Icon name="switch" size="sm" className="ml-auto text-ms-fg-3" />
          </a>
        </div>
      ) : null}
    </div>
  );
}
