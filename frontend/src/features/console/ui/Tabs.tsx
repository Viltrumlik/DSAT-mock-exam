"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/cn";

/**
 * Underline tabs (design handoff v0.3, Controls board · Chips and tabs): the open tab is kept in the
 * address as `?tab=`, so a link, a reload and Back all land on it. A count or verdict follows a tab's name
 * only when it is worth knowing before opening ("Groups 3", "Attendance 72 %"). ← → Home End move between
 * tabs (WAI-ARIA tabs, automatic activation); on a phone the row scrolls sideways and keeps the open tab
 * in view.
 */
export type TabItem<T extends string> = {
  id: T;
  label: ReactNode;
  /** After the name: a count (3) or a verdict ("72 %"). */
  count?: number | string;
  /** The count's tone when it is a warning: "critical" for 2 unpaid, "attention" for 1 late. */
  tone?: "critical" | "attention";
  disabled?: boolean;
};

const COUNT_TONE = {
  neutral: "bg-ms-surface-2 text-ms-fg-2",
  critical: "bg-ms-critical-soft text-ms-critical-fg",
  attention: "bg-ms-attention-soft text-ms-attention-fg",
} as const;

export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix = "tab",
  ids,
  className,
}: {
  /** The row's name for a screen reader: "Student sections". */
  label: string;
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Tab `i` is `${idPrefix}-${id}`; its panel should carry `aria-labelledby` with that id. */
  idPrefix?: string;
  /** A page that already names its tabs and panels its own way (the detail pages' `person-tab-…`). */
  ids?: { tab: (id: T) => string; panel: (id: T) => string };
  className?: string;
}) {
  const tabDom = (id: T) => (ids ? ids.tab(id) : `${idPrefix}-${id}`);
  const panelDom = (id: T) => (ids ? ids.panel(id) : `${idPrefix}-${id}-panel`);
  const row = useRef<HTMLDivElement | null>(null);
  const enabled = tabs.filter((t) => !t.disabled);
  const tabEl = (id: T) => [...(row.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find((el) => el.id === tabDom(id));

  useEffect(() => {
    const el = row.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = enabled.findIndex((t) => t.id === value);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? enabled.length - 1 : (at + step + enabled.length) % enabled.length;
    const id = enabled[next]?.id;
    if (!id) return;
    onChange(id);
    tabEl(id)?.focus();
  };

  return (
    <div
      ref={row}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("flex gap-1 overflow-x-auto border-b border-ms-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    >
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            id={tabDom(t.id)}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={panelDom(t.id)}
            tabIndex={on ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            className={cn(
              "group relative -mb-px inline-flex h-12 shrink-0 items-center gap-2 whitespace-nowrap px-3.5 text-[15px] leading-none",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ms-ring disabled:cursor-not-allowed",
              on ? "font-bold text-ms-fg" : t.disabled ? "font-medium text-ms-fg-disabled" : "font-medium text-ms-fg-3 hover:text-ms-fg",
            )}
          >
            {t.label}
            {t.count !== undefined && t.count !== null && t.count !== "" ? (
              <span data-tab-count className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[12px] font-semibold tabular-nums", COUNT_TONE[t.tone ?? "neutral"])}>
                {t.count}
              </span>
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-3.5 bottom-0 h-[3px] rounded-t-[3px] transition-colors duration-150",
                on ? "bg-ms-primary" : t.disabled ? "bg-transparent" : "bg-transparent group-hover:bg-ms-border-strong",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/** The panel under a tab row: labelled by its tab, focusable so Tab moves from the row into it. */
export function TabPanel({ idPrefix = "tab", id, children, className }: { idPrefix?: string; id: string; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-${id}-panel`} aria-labelledby={`${idPrefix}-${id}`} tabIndex={0} className={cn("focus-visible:outline-none", className)}>
      {children}
    </div>
  );
}

/** Which tab is open, from `?tab=` (or `key`); an unknown value falls back. Setting it replaces the address. */
export function useTabParam<T extends string>(allowed: readonly T[], fallback: T, key = "tab"): [T, (id: T) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params?.get(key) ?? "";
  const value = (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback(
    (id: T) => {
      const next = new URLSearchParams(params?.toString() ?? "");
      if (id === fallback) next.delete(key);
      else next.set(key, id);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : (pathname ?? ""), { scroll: false });
    },
    [params, router, pathname, key, fallback],
  );
  return [value, set];
}
