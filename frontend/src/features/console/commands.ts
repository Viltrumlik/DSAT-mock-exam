import type { IconName } from "@/components/ui/Icon";
import type { EntityKind, HitBadge } from "./entitySearch";
import type { OpsNavGroup } from "@/features/ops/shell/opsNav";

/** One thing ⌘K can do: open a page (`href`) or run an action (`run`). */
export type Command = {
  id: string;
  label: string;
  group: "Pages" | "Actions" | EntityKind;
  icon: IconName;
  href?: string;
  run?: () => void;
  /** Other words that find it ("dashboard", "crm"). */
  keywords?: string[];
  /** Quiet text after the label — a page's group ("Centre"), a student's phone. */
  hint?: string;
  /** A verdict on a found student, class or question ("Owes 750 000 so'm"). */
  badge?: HitBadge;
};

/**
 * ⌘K's commands: every page in the menu this person already sees, then the actions. It takes the
 * VISIBLE groups (after `visibleNav` / `visibleByRole`), so a page a role's menu hides is never
 * offered here either — the role rule lives in one place.
 */
export function consoleCommands(groups: readonly OpsNavGroup[], extra: readonly Command[] = []): Command[] {
  const pages = groups.flatMap((group) =>
    group.items.map(
      (item): Command => ({
        id: `page:${item.href}`,
        label: item.label,
        group: "Pages",
        icon: item.icon,
        href: item.href,
        hint: group.caption ?? undefined,
      }),
    ),
  );
  return [...pages, ...extra];
}

/**
 * The comparable form of a name: lower case, accents and every apostrophe kind dropped ("Oʻquv",
 * "O'quv", "O’quv" all read "oquv"), and punctuation and spaces gone, so "lcup" finds "lc-up (CRM
 * link)" and "support hours" finds "Support hours".
 */
export function compact(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Uzbek's oʻ/gʻ are written with U+02BB, which Unicode files as a LETTER, so it is named here.
    .replace(/[\u02bb\u02bc\u02b9'\u2019\u2018`\u00b4]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The commands a query finds, names that start with it first; all of them for an empty query. */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const q = compact(query);
  if (!q) return [...commands];
  const scored: { command: Command; rank: number; index: number }[] = [];
  commands.forEach((command, index) => {
    const label = compact(command.label);
    const rest = compact([command.hint ?? "", ...(command.keywords ?? [])].join(" "));
    const rank = label.startsWith(q) ? 0 : label.includes(q) ? 1 : rest.includes(q) ? 2 : -1;
    if (rank >= 0) scored.push({ command, rank, index });
  });
  return scored.sort((a, b) => a.rank - b.rank || a.index - b.index).map((s) => s.command);
}
