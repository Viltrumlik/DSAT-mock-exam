"use client";

import {
  activeTab as openTabOf,
  panelId as panelOf,
  TabBar as Bar,
  tabHref as hrefOf,
  tabId as tabOf,
  type Tab as AnyTab,
} from "@/features/ops/detail/tabs";
import { CalendarCheck, History, School, ShieldCheck, Trophy, UserRound, Users, Wallet } from "lucide-react";
import type { PersonCore } from "./personApi";

/**
 * A person's page is split into tabs (owner, 2026-10-15: "detailni ichida tablarga ajratib"), one
 * subject each, instead of every box on one long page. The bar, the address (`?tab=`) and the
 * keyboard are the console's shared ones (features/ops/detail/tabs.tsx); this says which tabs a
 * person has.
 */

export type TabKey = "overview" | "groups" | "payments" | "attendance" | "results" | "security" | "history" | "classes";
export type Tab = AnyTab<TabKey>;

export { TAB_PARAM } from "@/features/ops/detail/tabs";

const TAB: Record<TabKey, Tab> = {
  overview: { key: "overview", label: "Overview", icon: UserRound },
  groups: { key: "groups", label: "Groups", icon: Users },
  payments: { key: "payments", label: "Payments", icon: Wallet },
  attendance: { key: "attendance", label: "Attendance", icon: CalendarCheck },
  results: { key: "results", label: "Results", icon: Trophy },
  security: { key: "security", label: "Security", icon: ShieldCheck },
  history: { key: "history", label: "History", icon: History },
  classes: { key: "classes", label: "Classes", icon: School },
};

/** The tabs that apply to this person, in reading order. */
export function tabsFor(person: PersonCore): Tab[] {
  const keys: TabKey[] = ["overview"];
  if (person.section === "staff") {
    keys.push("classes");
  } else if (person.section === "students") {
    keys.push("groups");
    if (person.lcup) keys.push("payments");
    keys.push("attendance", "results");
  } else {
    // A public user sees only mock exams and events, and sits in no class — unless they once did.
    keys.push("results");
    if (person.lcup) keys.push("payments");
    if (person.past_groups.length > 0 || person.groups.length > 0) keys.push("groups");
  }
  keys.push("security", "history");
  return keys.map((k) => TAB[k]);
}

/** The open tab from the address. Anything unknown, or not this person's, is the Overview. */
export const activeTab = (search: URLSearchParams, tabs: Tab[]): TabKey => openTabOf(search, tabs);

/** The address with `key` open, every other parameter kept — the list's `_changelist_filters` above all. */
export const tabHref = (path: string, search: URLSearchParams, key: TabKey): string =>
  hrefOf(path, search, key, "overview");

export const tabId = (key: TabKey) => tabOf("person", key);
export const panelId = (key: TabKey) => panelOf("person", key);

export function TabBar({ tabs, active, onSelect }: { tabs: Tab[]; active: TabKey; onSelect: (key: TabKey) => void }) {
  return <Bar scope="person" label="Account sections" tabs={tabs} active={active} onSelect={onSelect} />;
}
