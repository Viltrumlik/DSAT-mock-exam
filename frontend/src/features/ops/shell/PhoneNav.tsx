"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { usePresence } from "@/features/console/ui/presence";
import { cn } from "@/lib/cn";
import { firstHref, type ConsoleCategory, type OpsNavCountKey } from "./opsNav";
import { CountBadge } from "./Panel";
import { FLAG_TONE } from "./Rail";
import type { Flag, Tier } from "./shellModel";
import type { Pin } from "./shellStore";

/** The phone's tab bar holds five: the categories in rail order, the fifth "More" when there are more than five. */
export function phoneTabs(categories: readonly ConsoleCategory[]): { shown: ConsoleCategory[]; more: ConsoleCategory[] } {
  if (categories.length <= 5) return { shown: [...categories], more: [] };
  return { shown: categories.slice(0, 4), more: categories.slice(4) };
}

export const MORE = "more";

/**
 * Phone · 390 px (design handoff v0.4, Shell board): the rail becomes the bottom tab bar — the same categories, in
 * the same order (Admin's Content and System go under More). A tab goes to its category's first page; tapping the
 * open one again (or More) opens its sub-categories as a sheet of big tiles. Every target is 44 px or more.
 */
export function PhoneTabBar({
  label,
  categories,
  activeId,
  flags,
  sheetFor,
  onOpenSheet,
}: {
  label: string;
  categories: readonly ConsoleCategory[];
  activeId: string | null;
  flags: ReadonlyMap<string, Flag>;
  /** The category (or "more") whose sheet is open. */
  sheetFor: string | null;
  onOpenSheet: (id: string, from: HTMLElement) => void;
}) {
  const { shown, more } = phoneTabs(categories);
  const moreOn = more.some((c) => c.id === activeId);
  const moreFlag = worstFlag(more.map((c) => flags.get(c.id)));
  const tab = "relative flex min-h-16 flex-col items-center justify-center gap-1 text-[11.5px] leading-none outline-none focus-visible:bg-ms-surface-2";
  return (
    <nav
      id="ops-tabbar"
      aria-label={`${label} categories`}
      className="fixed inset-x-0 bottom-0 z-40 grid border-t border-ms-border bg-ms-card pb-[env(safe-area-inset-bottom)] md:hidden"
      style={{ gridTemplateColumns: `repeat(${shown.length + (more.length ? 1 : 0)}, minmax(0, 1fr))` }}
    >
      {shown.map((c) => {
        const on = c.id === activeId;
        return (
          <Link
            key={c.id}
            href={firstHref(c)}
            data-category={c.id}
            aria-current={on ? "true" : undefined}
            aria-haspopup={on && !c.home ? "dialog" : undefined}
            aria-expanded={on && !c.home ? sheetFor === c.id : undefined}
            onClick={(e: MouseEvent<HTMLAnchorElement>) => {
              if (!on || c.home) return;
              e.preventDefault();
              onOpenSheet(c.id, e.currentTarget);
            }}
            className={cn(tab, on ? "font-bold text-ms-fg" : "font-medium text-ms-fg-3")}
          >
            <TabIcon icon={c.icon} flag={flags.get(c.id)} />
            {c.label}
          </Link>
        );
      })}
      {more.length ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={sheetFor === MORE}
          aria-current={moreOn ? "true" : undefined}
          onClick={(e) => onOpenSheet(MORE, e.currentTarget)}
          className={cn(tab, moreOn ? "font-bold text-ms-fg" : "font-medium text-ms-fg-3")}
        >
          <TabIcon icon="menu" flag={moreFlag} />
          More
        </button>
      ) : null}
    </nav>
  );
}

function worstFlag(flags: readonly (Flag | undefined)[]): Flag | undefined {
  const list = flags.filter((f): f is Flag => Boolean(f));
  if (list.length === 0) return undefined;
  const rank = { critical: 3, attention: 2, info: 1 } as const;
  return list.reduce((a, b) => ({ count: a.count + b.count, tone: rank[b.tone] > rank[a.tone] ? b.tone : a.tone }));
}

function TabIcon({ icon, flag }: { icon: ConsoleCategory["icon"]; flag?: Flag }) {
  return (
    <span className="relative">
      <Icon name={icon} size="xl" />
      {flag ? (
        <>
          <span
            aria-hidden
            className={cn(
              "absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums shadow-[0_0_0_2px_var(--ms-card)]",
              FLAG_TONE[flag.tone],
            )}
          >
            {flag.count}
          </span>
          <span className="sr-only">, {flag.count} need you</span>
        </>
      ) : null}
    </span>
  );
}

/**
 * The phone's sub-category sheet: the pins, then one big tile per page with its count (Shell board, Phone). It sits
 * above the tab bar, which stays usable; a tap on a tile, the scrim or Escape closes it and focus goes back to the tab.
 */
export function CategorySheet({
  sheetFor,
  categories,
  activeHref,
  pins,
  counts,
  keyed,
  onClose,
}: {
  sheetFor: string | null;
  categories: readonly ConsoleCategory[];
  activeHref: string | null;
  pins: readonly Pin[];
  counts: ReadonlyMap<string, { count?: number; tone: Tier }>;
  keyed: Partial<Record<OpsNavCountKey, number>>;
  onClose: () => void;
}) {
  const open = sheetFor !== null;
  const { mounted, closing } = usePresence(open);
  const box = useRef<HTMLDivElement | null>(null);
  // What the sheet shows while it leaves: the last one it was opened for.
  const [showing, setShowing] = useState(sheetFor);
  if (sheetFor && sheetFor !== showing) setShowing(sheetFor);

  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !showing) return null;
  const { more } = phoneTabs(categories);
  const sections = showing === MORE ? more : categories.filter((c) => c.id === showing);
  const title = showing === MORE ? "More" : (sections[0]?.label ?? "");

  return (
    <div className="md:hidden">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close menu"
        onClick={onClose}
        className={cn("fixed inset-0 z-30 bg-ms-scrim", closing ? "animate-ms-scrim-out pointer-events-none" : "animate-ms-scrim-in")}
      />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-t-[28px] bg-ms-card px-4 pb-4 pt-2 shadow-ms-3 outline-none",
          closing ? "animate-ms-sheet-out-bottom pointer-events-none" : "animate-ms-sheet-in-bottom",
        )}
      >
        <div aria-hidden className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-ms-surface-3" />
        <h2 className="px-1.5 pb-2.5 text-[22px] font-extrabold leading-7 tracking-[-.02em] text-ms-fg">{title}</h2>
        {pins.length > 0 ? (
          <section aria-label="Pinned" className="pb-3">
            <ul className="flex flex-wrap gap-1.5 px-1">
              {pins.map((p) => (
                <li key={p.href}>
                  <Link href={p.href} onClick={onClose} className="inline-flex h-11 max-w-[220px] items-center gap-1.5 rounded-[12px] bg-ms-surface-2 px-3 text-[14px] font-semibold text-ms-fg">
                    <Icon name={p.icon} size="sm" className="text-ms-fg-2" />
                    <span className="truncate">{p.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {sections.map((c) => (
          <section key={c.id} aria-label={c.label} className="pb-2">
            {showing === MORE ? <h3 className="px-1.5 pb-2 pt-1 text-[13px] font-bold text-ms-fg-3">{c.label}</h3> : null}
            <ul className="grid grid-cols-3 gap-2">
              {c.groups
                .flatMap((g) => g.items)
                .map((item) => {
                  const on = item.href === activeHref;
                  const count = item.countKey && keyed[item.countKey] ? { count: keyed[item.countKey], tone: "attention" as const } : counts.get(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={on ? "page" : undefined}
                        className={cn(
                          "relative flex min-h-[78px] flex-col items-center justify-center gap-1.5 rounded-[16px] px-1.5 py-3 text-center text-[13px] leading-4",
                          on ? "bg-ms-primary-soft font-bold text-ms-primary-text" : "bg-ms-surface font-semibold text-ms-fg",
                        )}
                      >
                        <Icon name={item.icon} size="lg" />
                        <span className="line-clamp-2">{item.label}</span>
                        {count ? <CountBadge count={count.count} tone={count.tone} className="absolute right-1.5 top-1.5 ml-0" /> : null}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
