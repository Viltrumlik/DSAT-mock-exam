"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import type { PersonCore } from "./personApi";

/**
 * A person's page is split into tabs (owner, 2026-10-15: "detailni ichida tablarga ajratib"), one
 * subject each, instead of every box on one long page. The open tab lives in the address
 * (`?tab=attendance`) so a link, a reload and Back land on it; a part loads only when its tab opens.
 *
 * Not the classroom's `Tabs` (features/classroom/ui/Tabs.tsx): those are the student app's solid
 * pills. The console is Django-admin plain, so its tabs are text with an underline.
 */

export type TabKey = "overview" | "groups" | "payments" | "attendance" | "results" | "security" | "history" | "classes";
export type Tab = { key: TabKey; label: string };

export const TAB_PARAM = "tab";

/** The tabs that apply to this person, in reading order. */
export function tabsFor(person: PersonCore): Tab[] {
  const tabs: Tab[] = [{ key: "overview", label: "Overview" }];
  if (person.section === "staff") {
    tabs.push({ key: "classes", label: "Classes" });
  } else if (person.section === "students") {
    tabs.push({ key: "groups", label: "Groups" });
    if (person.lcup) tabs.push({ key: "payments", label: "Payments" });
    tabs.push({ key: "attendance", label: "Attendance" }, { key: "results", label: "Results" });
  } else {
    // A public user sees only mock exams and events, and sits in no class — unless they once did.
    tabs.push({ key: "results", label: "Results" });
    if (person.lcup) tabs.push({ key: "payments", label: "Payments" });
    if (person.past_groups.length > 0 || person.groups.length > 0) tabs.push({ key: "groups", label: "Groups" });
  }
  tabs.push({ key: "security", label: "Security" }, { key: "history", label: "History" });
  return tabs;
}

/** The open tab from the address. Anything unknown, or not this person's, is the Overview. */
export function activeTab(search: URLSearchParams, tabs: Tab[]): TabKey {
  const want = search.get(TAB_PARAM);
  return tabs.find((t) => t.key === want)?.key ?? "overview";
}

/** The address with `key` open, every other parameter kept — the list's `_changelist_filters` above all. */
export function tabHref(path: string, search: URLSearchParams, key: TabKey): string {
  const next = new URLSearchParams(search.toString());
  if (key === "overview") next.delete(TAB_PARAM);
  else next.set(TAB_PARAM, key);
  const qs = next.toString();
  return qs ? `${path}?${qs}` : path;
}

export const tabId = (key: TabKey) => `person-tab-${key}`;
export const panelId = (key: TabKey) => `person-panel-${key}`;

/** An underline tab bar. Arrow keys, Home and End move between tabs; on a phone the bar scrolls sideways. */
export function TabBar({ tabs, active, onSelect }: { tabs: Tab[]; active: TabKey; onSelect: (key: TabKey) => void }) {
  const refs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});

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
        role="tablist"
        aria-label="Account sections"
        onKeyDown={onKeyDown}
        className="-mb-px flex gap-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              id={tabId(t.key)}
              aria-selected={on}
              aria-controls={panelId(t.key)}
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
