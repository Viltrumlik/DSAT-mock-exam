"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";

/**
 * The tabs of an /ops change form — a person's, a class's (owner, 2026-10-15: "detailni ichida
 * tablarga ajratib"). The open tab lives in the address (`?tab=attendance`) so a link, a reload and
 * Back land on it; the first tab is the page's own address, with no parameter.
 *
 * Not the classroom app's `Tabs` (features/classroom/ui/Tabs.tsx): those are the student app's
 * solid pills. The console is Django-admin plain, so its tabs are text with an underline.
 */

export type Tab<K extends string = string> = { key: K; label: string };

export const TAB_PARAM = "tab";

/** The open tab from the address. Anything unknown, or not offered here, is the first tab. */
export function activeTab<K extends string>(search: URLSearchParams, tabs: Tab<K>[]): K {
  const want = search.get(TAB_PARAM);
  return tabs.find((t) => t.key === want)?.key ?? tabs[0].key;
}

/**
 * The address with `key` open, every other parameter kept — the list's `_changelist_filters`
 * above all. `first` (the default tab) leaves the parameter out.
 */
export function tabHref<K extends string>(path: string, search: URLSearchParams, key: K, first: K): string {
  const next = new URLSearchParams(search.toString());
  if (key === first) next.delete(TAB_PARAM);
  else next.set(TAB_PARAM, key);
  const qs = next.toString();
  return qs ? `${path}?${qs}` : path;
}

export const tabId = (scope: string, key: string) => `${scope}-tab-${key}`;
export const panelId = (scope: string, key: string) => `${scope}-panel-${key}`;

const FADE = 32;

/** A fade on the edge(s) the bar can still scroll towards — the only sign on a phone that more tabs exist. */
export function fadeMask(left: boolean, right: boolean): CSSProperties | undefined {
  if (!left && !right) return undefined;
  const image =
    left && right
      ? `linear-gradient(to right, transparent, #000 ${FADE}px, #000 calc(100% - ${FADE}px), transparent)`
      : right
        ? `linear-gradient(to right, #000 calc(100% - ${FADE}px), transparent)`
        : `linear-gradient(to left, #000 calc(100% - ${FADE}px), transparent)`;
  return { maskImage: image, WebkitMaskImage: image };
}

/**
 * An underline tab bar. Arrow keys, Home and End move between tabs. On a phone the bar scrolls
 * sideways: the open tab is scrolled into view (a link to the last tab would otherwise open with no
 * tab underlined in sight), and the edge with more tabs behind it fades.
 */
export function TabBar<K extends string>({
  scope,
  label,
  tabs,
  active,
  onSelect,
}: {
  /** Prefixes the tab and panel ids, so two pages' tabs never share one. */
  scope: string;
  label: string;
  tabs: Tab<K>[];
  active: K;
  onSelect: (key: K) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = barRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);

  useEffect(() => {
    // `nearest` on both axes: the bar scrolls sideways to the tab, the page does not jump.
    refs.current[active]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    measure();
  }, [active, measure]);

  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.key === active);
    const to =
      e.key === "ArrowRight"
        ? (at + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (at - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    onSelect(tabs[to].key);
    refs.current[tabs[to].key]?.focus();
  };

  return (
    <div className="border-b border-border">
      <div
        ref={barRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        onScroll={measure}
        style={fadeMask(more.left, more.right)}
        className="-mb-px flex gap-4 overflow-x-auto [scrollbar-width:none] sm:gap-6 [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              ref={(el) => {
                refs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              id={tabId(scope, t.key)}
              aria-selected={on}
              aria-controls={panelId(scope, t.key)}
              tabIndex={on ? 0 : -1}
              onClick={() => onSelect(t.key)}
              className={cn(
                "h-10 shrink-0 whitespace-nowrap border-b-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                on
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
