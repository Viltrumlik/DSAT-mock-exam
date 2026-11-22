"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { usePresence } from "@/features/console/ui/presence";
import { cn } from "@/lib/cn";
import type { ConsoleCategory, OpsNavItem } from "./opsNav";
import type { SidebarCounts } from "./Sidebar";

export const MORE = "more";
export const MORE_SHEET_ID = "ops-more";

/**
 * The phone's tabs (PhoneStudent / PhoneGroup / PhoneDebtors boards): the four daily places — Today, Students, Groups,
 * Finance — then More. The first four `main` items the viewer may open become tabs (the Builder, which marks none,
 * gets its first four pages); every other page sits in More's sheet, under its section's caption.
 */
export function phoneTabs(categories: readonly ConsoleCategory[]): { shown: OpsNavItem[]; more: ConsoleCategory[] } {
  const items = categories.flatMap((c) => c.groups.flatMap((g) => g.items)).filter((i) => !i.hidden);
  const mains = items.filter((i) => i.main);
  const pool = mains.length >= 2 ? mains : items;
  const shown = pool.length <= 5 && items.length <= 5 ? items : pool.slice(0, 4);
  const taken = new Set(shown.map((i) => i.href));
  const more = categories
    .map((c) => ({ ...c, groups: c.groups.map((g) => ({ ...g, items: g.items.filter((i) => !i.hidden && !taken.has(i.href)) })).filter((g) => g.items.length) }))
    .filter((c) => c.groups.length > 0);
  return { shown, more };
}

export function PhoneTabBar({
  label,
  categories,
  activeHref,
  counts,
  moreOpen,
  onToggleMore,
}: {
  label: string;
  categories: readonly ConsoleCategory[];
  activeHref: string | null;
  counts: SidebarCounts;
  moreOpen: boolean;
  onToggleMore: (from: HTMLElement) => void;
}) {
  const { shown, more } = phoneTabs(categories);
  const moreOn = Boolean(activeHref) && !shown.some((i) => i.href === activeHref);
  const moreCount = more.reduce((n, c) => n + c.groups.reduce((m, g) => m + g.items.reduce((k, i) => k + (counts.get(i.href) ?? 0), 0), 0), 0);
  const tab = "relative flex min-h-16 flex-col items-center justify-center gap-1 text-[11.5px] leading-none outline-none focus-visible:bg-ms-surface-2";
  return (
    <nav
      id="ops-tabbar"
      aria-label={`${label} sections`}
      className="fixed inset-x-0 bottom-0 z-40 grid border-t border-ms-border bg-ms-card pb-[env(safe-area-inset-bottom)] md:hidden"
      style={{ gridTemplateColumns: `repeat(${shown.length + (more.length ? 1 : 0)}, minmax(0, 1fr))` }}
    >
      {shown.map((item) => {
        const on = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            data-tab={item.href}
            aria-current={on ? "page" : undefined}
            className={cn(tab, on ? "font-bold text-ms-primary-text" : "font-medium text-ms-fg-3")}
          >
            <TabIcon icon={item.icon} count={counts.get(item.href) ?? 0} />
            {item.label}
          </Link>
        );
      })}
      {more.length ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-controls={moreOpen ? MORE_SHEET_ID : undefined}
          aria-current={moreOn ? "true" : undefined}
          onClick={(e: MouseEvent<HTMLButtonElement>) => onToggleMore(e.currentTarget)}
          className={cn(tab, moreOn ? "font-bold text-ms-primary-text" : "font-medium text-ms-fg-3")}
        >
          <TabIcon icon="grid" count={moreCount} />
          More
        </button>
      ) : null}
    </nav>
  );
}

function TabIcon({ icon, count }: { icon: OpsNavItem["icon"]; count: number }) {
  return (
    <span className="relative">
      <Icon name={icon} size="xl" />
      {count > 0 ? (
        <>
          <span
            aria-hidden
            className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-ms-danger-btn px-1 text-[10px] font-bold leading-none tabular-nums text-white shadow-[0_0_0_2px_var(--ms-card)]"
          >
            {count > 99 ? "99+" : count}
          </span>
          <span className="sr-only">, {count}</span>
        </>
      ) : null}
    </span>
  );
}

/** More's sheet: every page that is not a tab, under its section's caption, each with its tile. */
export function MoreSheet({
  open,
  categories,
  activeHref,
  counts,
  onClose,
}: {
  open: boolean;
  categories: readonly ConsoleCategory[];
  activeHref: string | null;
  counts: SidebarCounts;
  onClose: () => void;
}) {
  const { mounted, closing } = usePresence(open);
  const box = useRef<HTMLDivElement | null>(null);
  const { more } = phoneTabs(categories);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <div className="md:hidden">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close menu"
        onClick={onClose}
        className={cn("fixed inset-0 z-40 bg-ms-scrim", closing ? "animate-ms-scrim-out pointer-events-none" : "animate-ms-scrim-in")}
      />
      <div
        ref={box}
        id={MORE_SHEET_ID}
        role="dialog"
        aria-modal="true"
        aria-label="More sections"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[82vh] flex-col overflow-y-auto rounded-t-ms-dlg border-t border-ms-border-strong bg-ms-card px-3 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2",
          closing ? "animate-ms-sheet-out-bottom pointer-events-none" : "animate-ms-sheet-in-bottom",
        )}
      >
        <div aria-hidden className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-ms-border-strong" />
        {more.map((c) => (
          <section key={c.id} aria-label={c.label} className="flex flex-col gap-0.5">
            {c.home ? null : <h2 className="px-2.5 pb-1.5 pt-3 text-[12px] font-semibold uppercase tracking-[.04em] text-ms-fg-3">{c.label}</h2>}
            {c.groups
              .flatMap((g) => g.items)
              .map((item) => {
                const on = item.href === activeHref;
                const count = counts.get(item.href) ?? 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-[9px] px-2.5 text-[15px]",
                      on ? "bg-ms-primary-soft font-semibold text-ms-primary-text" : "font-medium text-ms-fg",
                    )}
                  >
                    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-[9px] text-white" style={{ backgroundColor: item.tone ?? "#2a68c0" }}>
                      <Icon name={item.icon} size="sm" className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {count > 0 ? (
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ms-danger-btn px-1.5 text-[11.5px] font-bold text-white">{count}</span>
                    ) : null}
                  </Link>
                );
              })}
          </section>
        ))}
      </div>
    </div>
  );
}
