"use client";

import {
  activeTab as openTabOf,
  panelId as panelOf,
  TabBar as Bar,
  tabHref as hrefOf,
  tabId as tabOf,
  type Tab as AnyTab,
} from "@/features/ops/detail/tabs";
import { CalendarCheck, History, MessageSquare, School, ShieldCheck, Trophy, UserRound, Users, Wallet } from "lucide-react";
import { Tabs } from "@/features/console/ui";
import type { PersonCore } from "./personApi";

/**
 * A person's page is split into tabs (owner, 2026-10-15: "detailni ichida tablarga ajratib"), one
 * subject each, instead of every box on one long page. The bar, the address (`?tab=`) and the
 * keyboard are the console's shared ones (features/ops/detail/tabs.tsx); this says which tabs a
 * person has.
 */

export type TabKey =
  | "overview" | "groups" | "payments" | "attendance" | "results" | "sms" | "security" | "history" | "classes";
export type Tab = AnyTab<TabKey>;

export { TAB_PARAM } from "@/features/ops/detail/tabs";

const TAB: Record<TabKey, Tab> = {
  overview: { key: "overview", label: "Overview", icon: UserRound },
  groups: { key: "groups", label: "Groups", icon: Users },
  payments: { key: "payments", label: "Payments", icon: Wallet },
  attendance: { key: "attendance", label: "Attendance", icon: CalendarCheck },
  results: { key: "results", label: "Results", icon: Trophy },
  sms: { key: "sms", label: "SMS", icon: MessageSquare },
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
  // SMS go to lc-up's phone: a centre student, or anyone lc-up knows.
  if (person.section === "students" || person.lcup) keys.push("sms");
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

/** What a tab holds, said on the tab when worth knowing before opening (Controls board · Tabs). */
export function tabCounts(person: PersonCore): Partial<Record<TabKey, { count: number | string; tone?: "critical" | "attention" }>> {
  const out: Partial<Record<TabKey, { count: number | string; tone?: "critical" | "attention" }>> = {};
  if (person.groups.length) out.groups = { count: person.groups.length };
  const rate = person.glance?.attendance_rate;
  if (rate != null) out.attendance = { count: `${Math.round(rate)} %`, tone: rate < 60 ? "critical" : rate < 85 ? "attention" : undefined };
  const balance = person.lcup?.balance ?? null;
  if (balance !== null && balance < 0) out.payments = { count: "owes", tone: "critical" };
  if (person.staff) out.classes = { count: person.staff.classes.length };
  return out;
}

/** The console's underline tabs (`?tab=` kept by the caller), with the counts above. */
export function TabBar({ tabs, active, onSelect, person }: { tabs: Tab[]; active: TabKey; onSelect: (key: TabKey) => void; person?: PersonCore }) {
  const counts = person ? tabCounts(person) : {};
  return (
    <Tabs<TabKey>
      label="Account sections"
      value={active}
      onChange={onSelect}
      ids={{ tab: tabId, panel: panelId }}
      tabs={tabs.map((t) => ({ id: t.key, label: t.label, count: counts[t.key]?.count, tone: counts[t.key]?.tone }))}
    />
  );
}

/** The old bar, kept for pages not redesigned yet. */
export const LegacyTabBar = Bar;
