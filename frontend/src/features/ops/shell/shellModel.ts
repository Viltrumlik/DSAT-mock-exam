import type { AttentionItem, AttentionSource } from "@/features/console/attention";
import { categoryOf, pathOnly, type ConsoleCategory } from "./opsNav";

/**
 * The numbers on the v0.4 shell (Shell board): a FLAG on a category = how many "Needs you" items link into it,
 * coloured by the worst tier among them; a COUNT beside a page = what waits behind it (22 SMS, 13 debtors).
 * Today / Studio home carry every item — it is where "Needs you" lives. All of it comes from the bell's own
 * sources: no request of its own.
 */
export type Tier = "critical" | "attention" | "info";
export type Flag = { count: number; tone: Tier };

const RANK: Record<Tier, number> = { critical: 3, attention: 2, info: 1 };
const worse = (a: Tier, b: Tier): Tier => (RANK[b] > RANK[a] ? b : a);

/** The items that are there to act on (a source still loading or failed has none — the bell says so). */
export function attentionItems(sources: readonly AttentionSource[]): AttentionItem[] {
  return sources.flatMap((s) => (s.status === "done" && s.item ? [s.item] : []));
}

/** Category id → its flag. */
export function categoryFlags(items: readonly AttentionItem[], categories: readonly ConsoleCategory[]): Map<string, Flag> {
  const flags = new Map<string, Flag>();
  const add = (id: string, tone: Tier) => {
    const f = flags.get(id);
    flags.set(id, f ? { count: f.count + 1, tone: worse(f.tone, tone) } : { count: 1, tone });
  };
  const home = categories.filter((c) => c.home);
  for (const item of items) {
    for (const h of home) add(h.id, item.tone);
    const found = categoryOf(item.action.href, categories);
    if (found && !found.category.home) add(found.category.id, item.tone);
  }
  return flags;
}

/** Page href → what waits behind it: the items' numbers added up (none when an item carries no number). */
export function pageCounts(items: readonly AttentionItem[], categories: readonly ConsoleCategory[]): Map<string, { count?: number; tone: Tier }> {
  const counts = new Map<string, { count?: number; tone: Tier }>();
  for (const item of items) {
    const found = categoryOf(pathOnly(item.action.href), categories);
    if (!found || found.category.home) continue;
    const href = found.item.href;
    const prev = counts.get(href);
    const sum = item.count === undefined ? prev?.count : (prev?.count ?? 0) + item.count;
    counts.set(href, { count: sum, tone: prev ? worse(prev.tone, item.tone) : item.tone });
  }
  return counts;
}

/** "Enrolment, money, messages and help" — the panel's line under a category's name, from its own groups. */
export function groupLine(category: ConsoleCategory): string {
  const words = category.groups.flatMap((g) => (g.caption ? [g.caption] : []));
  if (words.length === 0) return "";
  const lower = words.map((w, i) => (i === 0 ? w : w.charAt(0).toLowerCase() + w.slice(1)));
  return lower.length === 1 ? lower[0] : `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}

/** The href that opens a page on one of its tabs; the first tab is the page itself, as its own tab bar leaves it. */
export function tabHref(href: string, tabs: readonly { id: string }[], id: string): string {
  return tabs[0]?.id === id ? href : `${href}?tab=${encodeURIComponent(id)}`;
}
