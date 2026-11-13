"use client";

import { useEffect, useId, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { PublishedTabs } from "@/features/console/pageOutline";
import type { RecentItem } from "@/features/console/recent";
import { Avatar, prefersReducedMotion } from "@/features/console/ui";
import { cn } from "@/lib/cn";
import type { ConsoleCategory, OpsNavCountKey, OpsNavItem, OpsNavTab } from "./opsNav";
import { foldId, movePin, type Pin } from "./shellStore";
import { tabHref, type Tier } from "./shellModel";

const COUNT_TONE: Record<Tier, string> = {
  critical: "bg-ms-danger-btn text-white",
  attention: "bg-ms-attention-soft text-ms-attention-fg",
  info: "bg-ms-info-soft text-ms-info-fg",
};
const DOT_TONE: Record<Tier, string> = { critical: "bg-ms-critical", attention: "bg-ms-attention", info: "bg-ms-info" };

/** What waits behind a page or a tab: a number in its tier's colour, or a dot when the source has no number. */
export function CountBadge({ count, tone, quiet = false, className }: { count?: number | string; tone: Tier; quiet?: boolean; className?: string }) {
  if (count === undefined || count === "") {
    return (
      <span className={cn("ml-auto inline-flex size-5 shrink-0 items-center justify-center", className)}>
        <span aria-hidden className={cn("size-2 rounded-full", DOT_TONE[tone])} />
        <span className="sr-only">needs you</span>
      </span>
    );
  }
  return (
    <span
      aria-label={`${count} waiting`}
      className={cn(
        "ml-auto inline-flex h-5 min-w-[22px] shrink-0 items-center justify-center rounded-full px-1.5 text-[12px] font-semibold leading-none tabular-nums",
        quiet ? "bg-ms-surface-2 text-ms-fg-2" : COUNT_TONE[tone],
        className,
      )}
    >
      {count}
    </span>
  );
}

export type PanelProps = {
  category: ConsoleCategory;
  /** pinned beside the rail · floating beside it (folded panel) · a sheet from the left (tablet). */
  variant: "pinned" | "flyout" | "sheet";
  pathname: string;
  /** The page you are on (longest match), if it is in the map. */
  activeHref: string | null;
  /** The open page's own tabs, when it published them. */
  published: PublishedTabs | null;
  /** Page href → what waits behind it, from "Needs you". */
  counts: ReadonlyMap<string, { count?: number; tone: Tier }>;
  /** Counts the shell fetches for the map's `countKey`s (Trials). */
  keyed: Partial<Record<OpsNavCountKey, number>>;
  pins: readonly Pin[];
  onPinsChange: (next: Pin[]) => void;
  folded: readonly string[];
  onToggleFold: (id: string) => void;
  recent: readonly RecentItem[];
  /** The line under the category's name. */
  subline: string;
  temp: "admin" | "builder";
  /** Pinned panel: fold it to the flyout (`[`). */
  onCollapse?: () => void;
  /** Flyout and sheet: close after a choice. */
  onClose?: () => void;
};

/**
 * The sub-category panel (design handoff v0.4, Shell board): the category's name, the pinned pages, then its groups
 * — folding, remembered per person — with the pages, their counts, and a page's own tabs as a tree (synced with
 * `?tab=`; only one tree open at a time). Today and Studio home list the cards on the page and the recently opened
 * pages instead. The same body is the pinned panel, the flyout of a folded panel, and the tablet's sheet.
 */
export function PanelBody(props: PanelProps) {
  const { category, variant, pathname, activeHref, published, pins, onPinsChange, onClose, onCollapse, temp } = props;

  // One tree open at a time: the open page's, unless the person opened another (until they move on).
  const defaultTree = activeHref && (published || itemOf(category, activeHref)?.tabs) ? activeHref : null;
  const [manualTree, setManualTree] = useState<{ path: string; href: string | null } | null>(null);
  const openTree = manualTree && manualTree.path === pathname ? manualTree.href : defaultTree;
  const toggleTree = (href: string) => setManualTree({ path: pathname, href: openTree === href ? null : href });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {variant === "flyout" ? (
        <b className="block px-2.5 pb-1.5 text-[18px] font-extrabold leading-6 text-ms-fg">{category.label}</b>
      ) : (
        <div className="flex items-start gap-2 px-2 pb-3.5">
          <div className="min-w-0 flex-1">
            <h2 className={cn("text-[22px] font-extrabold leading-7 tracking-[-.025em] text-ms-fg", temp === "builder" && "font-ms-display")}>{category.label}</h2>
            {props.subline ? <p className="mt-0.5 text-[13px] leading-[18px] text-ms-fg-3">{props.subline}</p> : null}
          </div>
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Collapse panel"
              aria-keyshortcuts="["
              title="Collapse panel  ["
              className="ms-transition grid size-9 shrink-0 place-items-center rounded-full text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg"
            >
              <Icon name="panel" />
            </button>
          ) : null}
          {variant === "sheet" && onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="ms-transition grid size-11 shrink-0 place-items-center rounded-full text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg"
            >
              <Icon name="x" size="lg" />
            </button>
          ) : null}
        </div>
      )}

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1">
        {pins.length > 0 && variant !== "flyout" ? <PinsRow pins={pins} onChange={onPinsChange} onClose={onClose} pathname={pathname} /> : null}
        {category.home ? (
          <HomeGroups {...props} />
        ) : (
          category.groups.map((group, index) => {
            const id = foldId(category.id, group.id);
            const holdsActive = group.items.some((i) => i.href === activeHref);
            const folded = props.folded.includes(id) && !holdsActive;
            return (
              <Group
                key={group.id}
                id={id}
                caption={group.caption}
                count={group.items.length}
                folded={folded}
                onToggle={props.onToggleFold}
                first={index === 0 && (pins.length === 0 || variant === "flyout")}
              >
                {group.items.map((item) => (
                  <PageRow
                    key={item.href}
                    item={item}
                    on={item.href === activeHref}
                    atPage={item.href === activeHref && pathname === item.href}
                    tabs={item.href === activeHref && published ? published.tabs : item.tabs}
                    current={item.href === activeHref ? published : null}
                    treeOpen={openTree === item.href}
                    onToggleTree={() => toggleTree(item.href)}
                    count={item.countKey && props.keyed[item.countKey] ? { count: props.keyed[item.countKey], tone: "attention" } : props.counts.get(item.href)}
                    onClose={onClose}
                  />
                ))}
              </Group>
            );
          })
        )}
      </div>

      {variant === "pinned" ? (
        <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-ms-border px-2.5 pt-3 text-[13px] text-ms-fg-3">
          <Key>G</Key>
          <Key>{category.letter}</Key>
          {category.home ? `${category.label} from anywhere` : `jump to ${category.label}`}
        </div>
      ) : null}
    </div>
  );
}

const Key = ({ children }: { children: string }) => (
  <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] border border-ms-border-strong bg-ms-surface px-1.5 font-ms-mono text-[12px] font-medium leading-none text-ms-fg-2">
    {children}
  </kbd>
);

function itemOf(category: ConsoleCategory, href: string): OpsNavItem | undefined {
  return category.groups.flatMap((g) => g.items).find((i) => i.href === href);
}

/** A sub-category: its name folds it (the number = its pages); uncaptioned groups have no header. */
function Group({
  id,
  caption,
  count,
  folded,
  onToggle,
  first,
  children,
}: {
  id: string;
  caption: string | null;
  count: number;
  folded: boolean;
  onToggle: (id: string) => void;
  first: boolean;
  children: ReactNode;
}) {
  const listId = useId();
  return (
    <section aria-label={caption ?? undefined}>
      {caption ? (
        <button
          type="button"
          aria-expanded={!folded}
          aria-controls={listId}
          data-group={id}
          onClick={() => onToggle(id)}
          className={cn(
            "ms-transition flex w-full items-center gap-1.5 rounded-[8px] px-2.5 pb-1.5 text-left text-[13px] font-bold leading-[18px] text-ms-fg-3 hover:text-ms-fg",
            first ? "pt-0" : "pt-3.5",
          )}
        >
          <Icon name={folded ? "right" : "down"} size="sm" className="size-3.5" />
          {caption}
          <span className="ml-auto text-[12px] font-semibold leading-none tabular-nums">{count}</span>
        </button>
      ) : null}
      <ul id={listId} hidden={folded} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </section>
  );
}

function PageRow({
  item,
  on,
  atPage,
  tabs,
  current,
  treeOpen,
  onToggleTree,
  count,
  onClose,
}: {
  item: OpsNavItem;
  /** The page you are on, or a record inside it. */
  on: boolean;
  /** Exactly this page (not a record under it). */
  atPage: boolean;
  tabs: readonly (OpsNavTab & { count?: number | string; tone?: "critical" | "attention" })[] | undefined;
  /** The page's own published tabs, when it is open. */
  current: PublishedTabs | null;
  treeOpen: boolean;
  onToggleTree: () => void;
  count?: { count?: number; tone: Tier };
  onClose?: () => void;
}) {
  const treeId = useId();
  const hasTree = Boolean(tabs && tabs.length > 0);
  return (
    <li>
      <div className={cn("relative flex min-h-10 items-center rounded-[12px]", on ? "bg-ms-surface-2" : "hover:bg-ms-surface")}>
        <Link
          href={item.href}
          aria-current={atPage ? "page" : on ? "true" : undefined}
          onClick={onClose}
          className={cn(
            "flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-[12px] px-2.5 text-[15px] leading-none text-ms-fg max-lg:min-h-11",
            on ? "font-bold" : "font-medium",
          )}
        >
          <Icon name={item.icon} className={on ? "text-ms-fg" : "text-ms-fg-2"} />
          <span className="line-clamp-2 min-w-0 py-1 leading-[18px]">{item.label}</span>
          {count ? <CountBadge count={count.count} tone={count.tone} /> : null}
        </Link>
        {hasTree ? (
          <button
            type="button"
            onClick={onToggleTree}
            aria-expanded={treeOpen}
            aria-controls={treeId}
            aria-label={`${item.label} tabs`}
            className="ms-transition mr-1 grid size-8 shrink-0 place-items-center rounded-[8px] text-ms-fg-3 hover:bg-ms-surface-3 hover:text-ms-fg"
          >
            <Icon name={treeOpen ? "down" : "right"} size="sm" />
          </button>
        ) : null}
      </div>
      {tabs && hasTree && treeOpen ? (
        <ul id={treeId} aria-label={`${item.label} tabs`} className="mb-1.5 ml-[21px] mt-0.5 flex flex-col gap-px border-l-2 border-ms-border pl-3">
          {tabs.map((t) => {
            const tabOn = current ? current.value === t.id : false;
            const href = tabHref(current ? current.path : item.href, tabs, t.id);
            return (
              <li key={t.id}>
                <Link
                  href={href}
                  data-tab={t.id}
                  aria-current={tabOn ? "true" : undefined}
                  onClick={(e: MouseEvent) => {
                    // The open page changes its own tab, exactly as its tab bar does (keeping its other filters).
                    if (current && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
                      e.preventDefault();
                      current.select(t.id);
                    }
                    onClose?.();
                  }}
                  className={cn(
                    "flex min-h-[34px] items-center gap-2 rounded-[10px] px-2.5 text-[14px] leading-none max-lg:min-h-11",
                    tabOn
                      ? "-ml-[14px] rounded-l-none pl-6 font-bold text-ms-fg shadow-[inset_3px_0_0_var(--ms-primary)]"
                      : "font-medium text-ms-fg-2 hover:bg-ms-surface hover:text-ms-fg",
                  )}
                >
                  <span className="truncate">{t.label}</span>
                  {t.count !== undefined && t.count !== "" ? <CountBadge count={t.count} tone={t.tone ?? "info"} quiet={!t.tone} /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

/** Pinned pages on top of every panel: links, dragged (or ⌥← / ⌥→) to reorder. */
function PinsRow({ pins, onChange, onClose, pathname }: { pins: readonly Pin[]; onChange: (next: Pin[]) => void; onClose?: () => void; pathname: string }) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [focusHref, setFocusHref] = useState<string | null>(null);
  useEffect(() => {
    if (!focusHref) return;
    [...document.querySelectorAll<HTMLElement>("[data-pin]")].find((el) => el.dataset.pin === focusHref)?.focus();
  }, [focusHref, pins]);

  const move = (from: number, to: number) => {
    const next = movePin(pins, from, to);
    if (next.every((p, i) => p === pins[i])) return;
    onChange(next);
    setFocusHref(pins[from].href);
  };

  return (
    <section aria-label="Pinned" className="pb-1">
      <div className="flex items-center gap-1.5 px-2.5 pb-1.5 text-[13px] font-bold leading-[18px] text-ms-fg-3">
        <Icon name="bookmark" size="sm" className="size-3.5" />
        Pinned
      </div>
      <ul className="flex flex-wrap gap-1.5 px-2 pb-1">
        {pins.map((p, i) => (
          <li
            key={p.href}
            onDragOver={(e: DragEvent) => {
              if (dragFrom !== null) e.preventDefault();
            }}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              if (dragFrom !== null) move(dragFrom, i);
              setDragFrom(null);
            }}
          >
            <Link
              href={p.href}
              data-pin={p.href}
              draggable
              onDragStart={(e: DragEvent) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragFrom(null)}
              onKeyDown={(e: KeyboardEvent) => {
                if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
                e.preventDefault();
                move(i, e.key === "ArrowLeft" ? i - 1 : i + 1);
              }}
              onClick={onClose}
              aria-current={pathOf(p.href) === pathname ? "true" : undefined}
              aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
              className={cn(
                "inline-flex h-[30px] max-w-[200px] items-center gap-1.5 rounded-[10px] bg-ms-surface-2 px-2.5 text-[13px] font-semibold leading-none text-ms-fg hover:bg-ms-surface-3 max-lg:h-11",
                dragFrom === i && "opacity-50",
              )}
            >
              <Icon name={p.icon} size="sm" className="size-3.5 text-ms-fg-2" />
              <span className="truncate">{p.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const pathOf = (href: string) => href.split(/[?#]/)[0];

/** Today / Studio home: the cards on the page (they scroll to it), then the recently opened pages. */
function HomeGroups({ category, folded, onToggleFold, recent, onClose, pathname, activeHref, pins, variant }: PanelProps) {
  const home = category.groups[0]?.items[0];
  const atHome = Boolean(home) && pathname === home?.href;
  const sections = usePageSections(atHome, pathname);
  const sectionsId = foldId(category.id, "on-this-page");
  const recentId = foldId(category.id, "recent");
  const noPinsAbove = pins.length === 0 || variant === "flyout";
  return (
    <>
      {!atHome && home ? (
        <ul className="flex flex-col gap-0.5">
          <PageRow item={home} on={activeHref === home.href} atPage={false} tabs={undefined} current={null} treeOpen={false} onToggleTree={() => undefined} onClose={onClose} />
        </ul>
      ) : null}
      {sections.length > 0 ? (
        <Group id={sectionsId} caption="On this page" count={sections.length} folded={folded.includes(sectionsId)} onToggle={onToggleFold} first={noPinsAbove}>
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const el = document.getElementById(s.id);
                  if (el) {
                    // Clear of the sticky top bar (64 px) with a little air.
                    const top = el.getBoundingClientRect().top + window.scrollY - 80;
                    window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? "auto" : "smooth" });
                  }
                  onClose?.();
                }}
                className="flex min-h-10 items-center gap-3 rounded-[12px] px-2.5 text-[15px] font-medium leading-none text-ms-fg hover:bg-ms-surface max-lg:min-h-11"
              >
                <span aria-hidden className="grid size-5 shrink-0 place-items-center">
                  <span className="size-1.5 rounded-full bg-ms-fg-3" />
                </span>
                <span className="truncate">{s.label}</span>
              </a>
            </li>
          ))}
        </Group>
      ) : null}
      {recent.length > 0 ? (
        <Group id={recentId} caption="Recent" count={Math.min(3, recent.length)} folded={folded.includes(recentId)} onToggle={onToggleFold} first={noPinsAbove && sections.length === 0 && atHome}>
          {recent.slice(0, 3).map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <Link
                href={r.href}
                onClick={onClose}
                className="flex min-h-10 items-center gap-3 rounded-[12px] px-2.5 text-[15px] font-medium leading-none text-ms-fg hover:bg-ms-surface max-lg:min-h-11"
              >
                {r.kind === "person" ? (
                  <Avatar name={r.name} size="sm" className="size-6! text-[10px]!" />
                ) : (
                  <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-ms-surface-2 text-ms-fg-2">
                    <Icon name={RECENT_ICON[r.kind]} size="sm" className="size-3.5" />
                  </span>
                )}
                <span className="truncate">{r.name}</span>
              </Link>
            </li>
          ))}
        </Group>
      ) : null}
    </>
  );
}

const RECENT_ICON: Record<RecentItem["kind"], IconName> = {
  person: "user",
  class: "cap",
  question: "ms-question",
  set: "layers",
  mock: "ms-fullmock",
  pastpaper: "ms-pastpaper",
};

/**
 * The cards on the open dashboard, in page order: every card marks itself with `data-ms-section="<its title>"` and an
 * `id`. Read from the page as it renders (cards appear as their data arrives), so the list never names a card the
 * page does not show to this person.
 */
function usePageSections(enabled: boolean, pathname: string): { id: string; label: string }[] {
  const [list, setList] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const main = document.getElementById("ops-main");
    if (!main) return;
    const read = () => {
      const next = [...main.querySelectorAll<HTMLElement>("[data-ms-section]")]
        .map((el) => ({ id: el.id, label: el.dataset.msSection ?? "" }))
        .filter((s) => s.id && s.label);
      setList((prev) => (prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.label === next[i].label) ? prev : next));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled, pathname]);
  return enabled ? list : [];
}
