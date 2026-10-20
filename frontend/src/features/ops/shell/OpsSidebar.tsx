"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { ChevronsLeft, ChevronsRight, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { activeNavItem, OPS_CONSOLE, type ConsoleConfig, type OpsNavCountKey, type OpsNavGroup } from "./opsNav";

export const OPS_SIDEBAR_ID = "ops-sidebar";

/**
 * The console's left rail, Django-admin style: flush to the window's left edge, full height,
 * grouped under small uppercase captions, one compact row per section.
 *
 * - `lg` and up: fixed, 240px, or a 64px icon rail when `collapsed` (labels move to `title`).
 * - Below `lg`: an off-canvas drawer (always full labels) that the top bar's hamburger opens.
 *   Closed, it is `invisible` as well as off-screen, so its links leave the tab order.
 *
 * `collapsed` only ever narrows the desktop rail — every collapsed style is `lg:`-prefixed.
 */
export function OpsSidebar({
  groups,
  pathname,
  collapsed,
  mobileOpen,
  onCloseMobile,
  onToggleCollapsed,
  closeButtonRef,
  config = OPS_CONSOLE,
  counts,
}: {
  groups: OpsNavGroup[];
  pathname: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onToggleCollapsed: () => void;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
  /** Which console this rail belongs to — its home, its name. */
  config?: Pick<ConsoleConfig, "root" | "brand" | "crumb" | "soft">;
  /** Work waiting behind a section, by its countKey — drawn beside the label when above zero. */
  counts?: Partial<Record<OpsNavCountKey, number>>;
}) {
  // One item is current: the longest match, so a nested item does not light up its parent too.
  const activeHref = activeNavItem(pathname, groups)?.href ?? null;
  return (
    <aside
      id={OPS_SIDEBAR_ID}
      aria-label={`${config.crumb} navigation`}
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-card transition-[transform,width,visibility] duration-200 ease-out",
        collapsed ? "lg:w-16" : "lg:w-60",
        mobileOpen ? "translate-x-0" : "max-lg:invisible max-lg:-translate-x-full",
      )}
    >
      {/* Identity — the same height as the top bar, so the two hairlines meet. */}
      <div
        className={cn(
          "flex h-12 shrink-0 items-center gap-2 border-b border-border px-4",
          collapsed && "lg:justify-center lg:px-0",
        )}
      >
        <Link
          href={config.root}
          className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          title={`MasterSAT ${config.brand}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="" aria-hidden className="h-6 w-6 shrink-0 object-contain" />
          <span className={cn("truncate text-sm font-bold text-foreground", collapsed && "lg:hidden")}>
            MasterSAT <span className="font-normal text-muted-foreground">{config.brand}</span>
          </span>
        </Link>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onCloseMobile}
          aria-label="Close menu"
          className="ml-auto grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav aria-label={`${config.crumb} sections`} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2">
        {groups.map((group, index) => (
          <div key={group.id} className={cn(index > 0 && (config.soft ? "mt-5" : "mt-3"))}>
            {group.caption ? (
              <>
                <p
                  className={cn(
                    "px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
                    collapsed && "lg:hidden",
                  )}
                >
                  {group.caption}
                </p>
                {/* On the icon rail a hairline stands in for the caption. */}
                {collapsed ? <div aria-hidden className="mx-2 mb-2 hidden h-px bg-border lg:block" /> : null}
              </>
            ) : null}
            <ul className="flex flex-col gap-px">
              {group.items.map((item) => {
                const active = item.href === activeHref;
                const Icon = item.icon;
                const count = item.countKey ? counts?.[item.countKey] ?? 0 : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onCloseMobile}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        config.soft ? "h-9 rounded-xl text-sm" : "h-8 rounded-md text-[13px]",
                        collapsed && "lg:justify-center lg:px-0",
                        active
                          ? "bg-primary-soft font-semibold text-primary dark:text-primary-hover"
                          : "text-foreground hover:bg-surface-2",
                      )}
                    >
                      {/* The soft frame's rounded pill is mark enough; the bar is the dense frame's. */}
                      {active && !config.soft ? (
                        <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />
                      ) : null}
                      <Icon
                        aria-hidden
                        className={cn("h-4 w-4 shrink-0", active ? "text-primary dark:text-primary-hover" : "text-muted-foreground")}
                      />
                      <span className={cn("truncate", collapsed && "lg:sr-only")}>{item.label}</span>
                      {count > 0 ? (
                        <span
                          aria-label={`${count} waiting`}
                          className={cn(
                            "ml-auto shrink-0 rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold tabular-nums text-amber-700 dark:text-amber-300",
                            collapsed && "lg:absolute lg:right-1 lg:top-0.5 lg:px-1",
                          )}
                        >
                          {count}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="hidden shrink-0 border-t border-border p-2 lg:block">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-controls={OPS_SIDEBAR_ID}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : undefined}
          className={cn(
            "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            // `lib/cn` is a plain join, not tailwind-merge: the variant is what beats `px-2.5`.
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4 shrink-0" /> : <ChevronsLeft className="h-4 w-4 shrink-0" />}
          {collapsed ? null : <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
