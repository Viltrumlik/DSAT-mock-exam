"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { activeNavItem, OPS_CONSOLE, type ConsoleConfig, type OpsNavCountKey, type OpsNavGroup } from "./opsNav";

export const OPS_SIDEBAR_ID = "ops-sidebar";

/**
 * The console's grouped menu (design handoff v0.3, Shell board): flush to the window's left edge,
 * full height, monochrome — the current section is a grey pill in bold, never blue chrome.
 *
 * - `lg` and up: fixed, 248 px (`--ms-sidebar`), or a 64 px icon rail (`--ms-rail`) when
 *   `collapsed` — labels move to `title` and stay the accessible name; a count becomes a dot.
 * - Below `lg`: an off-canvas drawer, up to 300 px wide (always full labels), that the top bar's
 *   menu button opens.
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
  config?: Pick<ConsoleConfig, "root" | "brand" | "crumb">;
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
        "fixed inset-y-0 left-0 z-40 flex w-[min(300px,85vw)] flex-col border-r border-ms-border bg-ms-card transition-[translate,width,visibility] duration-200 ease-ms-out",
        collapsed ? "lg:w-(--ms-rail)" : "lg:w-(--ms-sidebar)",
        mobileOpen ? "translate-x-0" : "max-lg:invisible max-lg:-translate-x-full",
      )}
    >
      {/* Identity — the top bar's height, so the two edges meet. */}
      <div className={cn("flex h-(--ms-topbar) shrink-0 items-center gap-2 px-4", collapsed && "lg:justify-center lg:px-0")}>
        <Link href={config.root} className="flex min-w-0 items-center gap-2.5 rounded-[10px] max-lg:min-h-11" title={`MasterSAT ${config.brand}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="" aria-hidden className="size-7 shrink-0 object-contain" />
          <span className={cn("truncate text-[16px] font-bold text-ms-fg", collapsed && "lg:hidden")}>
            MasterSAT <span className="font-medium text-ms-fg-3">{config.brand}</span>
          </span>
        </Link>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onCloseMobile}
          aria-label="Close menu"
          className="ms-transition ml-auto grid size-11 place-items-center rounded-full text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg lg:hidden"
        >
          <Icon name="x" size="lg" />
        </button>
      </div>

      <nav aria-label={`${config.crumb} sections`} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
        {groups.map((group, index) => (
          <div key={group.id} className={cn(index > 0 && !group.caption && "mt-3 border-t border-ms-border pt-3")}>
            {group.caption ? (
              <>
                <p className={cn("px-3 pb-1.5 pt-[18px] text-[14px] font-bold leading-5 text-ms-fg", collapsed && "lg:hidden")}>
                  {group.caption}
                </p>
                {/* On the icon rail a hairline stands in for the caption. */}
                {collapsed ? <div aria-hidden className="mx-2 my-3 hidden h-px bg-ms-border lg:block" /> : null}
              </>
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = item.href === activeHref;
                const count = item.countKey ? counts?.[item.countKey] ?? 0 : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onCloseMobile}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "ms-transition relative flex h-[42px] items-center gap-3.5 rounded-[12px] px-3 text-[15px] leading-none text-ms-fg max-lg:h-11",
                        collapsed && "lg:justify-center lg:px-0",
                        active ? "bg-ms-surface-2 font-bold" : "font-medium hover:bg-ms-surface",
                      )}
                    >
                      <Icon name={item.icon} className={active ? "text-ms-fg" : "text-ms-fg-2"} />
                      <span className={cn("truncate", collapsed && "lg:sr-only")}>{item.label}</span>
                      {count > 0 ? (
                        <>
                          <span
                            aria-label={`${count} waiting`}
                            className={cn(
                              "ml-auto inline-flex h-5 min-w-[22px] shrink-0 items-center justify-center rounded-full bg-ms-attention-soft px-1.5 text-[12px] font-semibold tabular-nums text-ms-attention-fg",
                              collapsed && "lg:sr-only",
                            )}
                          >
                            {count}
                          </span>
                          {/* On the rail the count is a dot in its tier's colour; the number stays for screen readers. */}
                          {collapsed ? (
                            <span data-count-dot aria-hidden className="absolute right-3 top-2.5 hidden size-2 rounded-full bg-ms-attention lg:block" />
                          ) : null}
                        </>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="hidden shrink-0 border-t border-ms-border p-3 lg:block">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-controls={OPS_SIDEBAR_ID}
          aria-expanded={!collapsed}
          aria-keyshortcuts="["
          title={collapsed ? "Expand sidebar  [" : "Collapse sidebar  ["}
          className={cn(
            "ms-transition flex h-10 w-full items-center gap-3.5 rounded-[12px] px-3 text-[14px] font-medium text-ms-fg-2 hover:bg-ms-surface hover:text-ms-fg",
            // `lib/cn` is a plain join, not tailwind-merge: the variant is what beats `px-3`.
            collapsed && "lg:justify-center lg:px-0",
          )}
        >
          <Icon name="panel" />
          {collapsed ? null : <span>Collapse</span>}
          {collapsed ? null : <span className="ml-auto rounded-[6px] border border-ms-border-strong px-1.5 font-ms-mono text-[12px] text-ms-fg-3">[</span>}
        </button>
      </div>
    </aside>
  );
}
