"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { CommandPalette } from "@/features/console/CommandPalette";
import { ShortcutsDialog } from "@/features/console/ShortcutsDialog";
import { Toaster } from "@/features/console/toast";
import { useAdminAttention, useBuilderAttention } from "@/features/console/attention";
import { consoleCommands } from "@/features/console/commands";
import { entityScope } from "@/features/console/entitySearch";
import { canOpenConsole, consoleHref } from "@/features/console/consoleHref";
import { PageOutlineProvider, usePublishedTabs } from "@/features/console/pageOutline";
import { useRecent } from "@/features/console/recent";
import type { MenuItem } from "@/features/console/ui/Menu";
import { financeApi } from "@/features/finance/financeApi";
import { financeKeys } from "@/features/finance/financeHooks";
import { useBranches } from "@/features/org/orgHooks";
import { P, holds } from "@/features/ops/permissions";
import { cn } from "@/lib/cn";
import { OpsTopBar } from "./OpsTopBar";
import { MoreSheet, PhoneTabBar } from "./PhoneNav";
import { Sidebar } from "./Sidebar";
import {
  OPS_CONSOLE,
  canSeeItem,
  categoryOf,
  crumbsFor,
  firstHref,
  flattenCategories,
  visibleCategories,
  type ConsoleConfig,
  type MeLike,
} from "./opsNav";
import { attentionItems } from "./shellModel";

/** A media query, read before the first paint; a DOM that cannot answer (tests) gets `fallback`. */
function useMedia(query: string, fallback: boolean): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
      const m = window.matchMedia(query);
      m.addEventListener?.("change", onChange);
      return () => m.removeEventListener?.("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}

const typing = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
};

/** What the data search finds, in this console, for this person: "Search students, groups, phones". */
function searchWords(kinds: readonly string[]): string {
  const words = kinds.map((k) => (k === "Classes" ? "groups" : k.toLowerCase()));
  if (words.includes("students")) words.push("phones");
  return `Search ${words.join(", ")}`;
}

/**
 * The consoles' frame (lc-up structure canvas, 22 Nov 2026 — Rail, TopBar and Shell boards; the owner picked the
 * light sidebar "A" after the v0.4 dark rail + panel was not liked):
 * - ≥ 1024 px: the 248 px sidebar with words, folding to 76 px icons (`[`, remembered per browser);
 * - 768–1023 px: the sidebar folded to icons;
 * - below 768 px: the bottom tabs (Today, Students, Groups, Finance, More) and More's sheet.
 * A top bar runs across the content column; the page fills the rest, up to 1600 px.
 *
 * Its root is the console surface (`.ms`): the redesign's tokens, Geist instead of the body's reading serif. Admin
 * wears the v0.7 "calm vivid" temperature (`data-ms-temp="admin"`: ruled tables, verdict tints, radii 8/12); the
 * Builder (questions.mastersat.uz) wears the same frame with its own map and its rounder temperature. The
 * temperature is also put on `<html>` while the frame is mounted, so dialogs portalled into `<body>` match.
 *
 * Mounted inside AuthGuard, which renders nothing of its children until `/users/me` has loaded, so this never
 * renders on the server and the fold preference is read before the first paint.
 *
 * The DOCUMENT scrolls, not a pane: the sidebar is `fixed` and the content column is padded clear of it, so the
 * top bar's `sticky` works and a phone can retract its address bar.
 */
export function OpsShell(props: { pathname: string; me: MeLike; children: React.ReactNode; config?: ConsoleConfig }) {
  return (
    <PageOutlineProvider pathname={props.pathname}>
      <Frame {...props} />
    </PageOutlineProvider>
  );
}

function Frame({
  pathname,
  me,
  children,
  config = OPS_CONSOLE,
}: {
  pathname: string;
  me: MeLike;
  children: React.ReactNode;
  config?: ConsoleConfig;
}) {
  const router = useRouter();
  const scope = config.temp === "builder" ? "builder" : "ops";
  const admin = config.temp === "admin";

  // ── The temperature on <html>, so portalled dialogs, menus and toasts wear it too ─────────────────────────────
  useLayoutEffect(() => {
    const html = document.documentElement;
    const before = html.getAttribute("data-ms-temp");
    html.setAttribute("data-ms-temp", config.temp);
    return () => {
      if (before === null) html.removeAttribute("data-ms-temp");
      else html.setAttribute("data-ms-temp", before);
    };
  }, [config.temp]);

  // ── What this person may open, and where they are ────────────────────────────────────────────────────────────
  const categories = useMemo(() => visibleCategories(config.categories, me, config.visible), [config, me]);
  const found = categoryOf(pathname, categories);
  const activeHref = found?.item.href ?? null;
  const published = usePublishedTabs(pathname);
  const recent = useRecent(scope);

  // ── Counts, only on verdicts: Today's "Needs you", Finance's debtors (students) ──────────────────────────────
  const adminAttention = useAdminAttention(admin ? me : null);
  // On Studio home the bell shares the page's summary (same key, recents included); elsewhere a stable one.
  const builderAttention = useBuilderAttention(!admin && Boolean(me), pathname === "/builder");
  const attention = admin ? adminAttention : builderAttention;
  const needsYou = useMemo(() => attentionItems(attention).length, [attention]);
  const items = useMemo(() => flattenCategories(categories).flatMap((g) => g.items), [categories]);
  const wantsDebtors = admin && items.some((i) => i.countKey === "debtors") && holds(me, P.viewMoney);
  // The Finance page's own list (same key): one request, shared, students who owe.
  const debtors = useQuery({ queryKey: financeKeys.debtors, queryFn: () => financeApi.debtors(), enabled: wantsDebtors, staleTime: 5 * 60 * 1000 });
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    const home = categories.find((c) => c.home);
    const homeHref = home ? firstHref(home) : null;
    if (homeHref && needsYou > 0) m.set(homeHref, needsYou);
    const debtorItem = items.find((i) => i.countKey === "debtors");
    const owing = wantsDebtors && Array.isArray(debtors.data) ? debtors.data.length : 0;
    if (debtorItem && owing > 0) m.set(debtorItem.href, owing);
    return m;
  }, [categories, items, needsYou, wantsDebtors, debtors.data]);

  // ── Where you are ────────────────────────────────────────────────────────────────────────────────────────────
  const detail = recent.find((r) => r.href === pathname)?.name ?? null;
  const crumbs = crumbsFor(pathname, {
    categories,
    root: config.root,
    rootLabel: config.crumb,
    tabs: published?.tabs ?? null,
    tab: published?.value ?? null,
    detail,
  });

  // ── The other console, for the brand's switch and ⌘K ────────────────────────────────────────────────────────
  // Only when this person may open it (a test admin is kept to the Builder by AuthGuard, so they get no Admin).
  const other = admin ? "builder" : "admin";
  const mayOpenOther = canOpenConsole(other, me);
  const otherConsole = useMemo(
    () =>
      mayOpenOther
        ? {
            label: other === "admin" ? "Admin" : "Builder",
            href: consoleHref(other, typeof window === "undefined" ? { protocol: "http:", host: "" } : window.location),
          }
        : null,
    [other, mayOpenOther],
  );

  // ── Two searches, as in lc-up: the data search (people, groups, phones) and Sections ⌘K (pages + actions) ─────
  const entityKinds = useMemo(() => entityScope(config.temp, me), [config.temp, me]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const { setTheme } = useTheme();
  const commands = useMemo(
    () =>
      consoleCommands(
        categories.flatMap((c) => c.groups.map((g) => ({ ...g, caption: c.home ? null : c.label }))),
        [
          ...(otherConsole
            ? [{ id: "switch", label: `Switch to ${otherConsole.label}`, group: "Actions" as const, icon: "switch" as const, href: otherConsole.href, keywords: ["console"] }]
            : []),
          { id: "theme-light", label: "Light theme", group: "Actions", icon: "sun", run: () => setTheme("light") },
          { id: "theme-dark", label: "Dark theme", group: "Actions", icon: "moon", run: () => setTheme("dark") },
          { id: "theme-system", label: "System theme", group: "Actions", icon: "monitor", run: () => setTheme("system") },
        ],
      ),
    [categories, otherConsole, setTheme],
  );

  // ── "+ New", the branch and the timetable: only what this person may do ─────────────────────────────────────
  const visibleHref = (href: string) => items.some((i) => i.href === href);
  const newItems = useMemo<MenuItem[]>(() => {
    if (!admin) return [];
    const list: MenuItem[] = [];
    if (visibleHref("/ops/classrooms") && holds(me, P.manageGroups)) list.push({ label: "New group", icon: "layers", href: "/ops/classrooms?new=1" });
    if (visibleHref("/ops/sms") && holds(me, P.sendSms)) list.push({ label: "SMS campaign", icon: "msg", href: "/ops/sms/campaigns/new" });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, me, items]);
  const branches = useBranchesFor(admin && holds(me, P.manageGroups));
  const timetable = items.find((i) => i.href === "/ops/timetable");
  const timetableHref = admin && timetable && canSeeItem(timetable, me) ? timetable.href : null;

  // ── Layout: the fold (remembered), forced on a tablet ───────────────────────────────────────────────────────
  const desktop = useMedia("(min-width: 1024px)", true);
  const [pref, setPref] = useState<"0" | "1" | null>(() => {
    try {
      const v = window.localStorage.getItem(config.collapseKey);
      return v === "1" || v === "0" ? v : null;
    } catch {
      return null;
    }
  });
  const folded = desktop ? pref === "1" : true;
  const toggleFold = useCallback(() => {
    const next = pref === "1" ? "0" : "1";
    setPref(next);
    try {
      window.localStorage.setItem(config.collapseKey, next);
    } catch {
      /* storage blocked — the choice just isn't remembered */
    }
  }, [pref, config.collapseKey]);

  const [moreOpen, setMoreOpen] = useState(false);
  const moreOpener = useRef<HTMLElement | null>(null);
  // Going somewhere closes the phone's More sheet.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setMoreOpen(false);
  }
  const closeMore = useCallback(() => {
    setMoreOpen(false);
    moreOpener.current?.focus();
  }, []);

  // ── Keys: `[` folds the sidebar; G then a letter jumps to a section ─────────────────────────────────────────
  const gAt = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "[" && desktop) {
        e.preventDefault();
        toggleFold();
        return;
      }
      const now = Date.now();
      if (e.key === "g" || e.key === "G") {
        gAt.current = now;
        return;
      }
      if (gAt.current && now - gAt.current < 1500 && e.key.length === 1) {
        gAt.current = 0;
        const target = categories.find((c) => c.letter.toLowerCase() === e.key.toLowerCase());
        if (target) {
          e.preventDefault();
          router.push(firstHref(target));
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleFold, categories, router, desktop]);

  return (
    <div className="ms min-h-screen" data-ms-temp={config.temp} data-sidebar={folded ? "folded" : "open"}>
      <a
        href="#ops-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-2 focus:z-50 focus:rounded-full focus:bg-ms-inverse-bg focus:px-4 focus:py-2 focus:text-[14px] focus:font-semibold focus:text-ms-inverse-fg"
      >
        Skip to content
      </a>
      <Toaster />
      <ShortcutsDialog />

      <Sidebar
        config={config}
        categories={categories}
        pathname={pathname}
        activeHref={activeHref}
        counts={counts}
        folded={folded}
        canFold={desktop}
        onToggleFold={toggleFold}
        otherConsole={otherConsole}
      />

      {/* No z-index here on purpose: a stacking context on this column would trap the pages'
          own `fixed z-50` dialogs beneath the sidebar. */}
      <div
        className={cn(
          "flex min-h-screen min-w-0 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] transition-[padding] duration-200 ease-ms-out md:pb-0 md:pl-(--ms-side-folded)",
          !folded && "lg:pl-(--ms-side)",
        )}
      >
        <OpsTopBar
          crumbs={crumbs}
          me={me}
          onOpenSearch={entityKinds.length ? () => setSearchOpen(true) : null}
          onOpenSections={() => setSectionsOpen(true)}
          attention={attention}
          searchLabel={searchWords(entityKinds)}
          newItems={newItems}
          branch={branches}
          timetableHref={timetableHref}
        />
        <main id="ops-main" className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-7 xl:px-8">
          <div className="mx-auto w-full max-w-(--ms-content-max)">{children}</div>
        </main>
      </div>

      <PhoneTabBar
        label={config.crumb}
        categories={categories}
        activeHref={activeHref}
        counts={counts}
        moreOpen={moreOpen}
        onToggleMore={(from) => {
          moreOpener.current = from;
          setMoreOpen((o) => !o);
        }}
      />
      <MoreSheet open={moreOpen} categories={categories} activeHref={activeHref} counts={counts} onClose={closeMore} />

      {/* Sections ⌘K: every page this person may open, then actions. */}
      <CommandPalette open={sectionsOpen} onOpenChange={setSectionsOpen} commands={commands} placeholder="Type a section's name…" />
      {/* The data search: students, groups and phones (Admin), questions (Builder). ⌘K stays with Sections. */}
      {entityKinds.length ? (
        <CommandPalette
          open={searchOpen}
          onOpenChange={setSearchOpen}
          commands={[]}
          entityKinds={entityKinds}
          placeholder={`${searchWords(entityKinds)}…`}
          hotkey={false}
        />
      ) : null}
    </div>
  );
}

/**
 * The branch switcher's words and menu. The console shows every branch at once (owner, 2026-11-12: no branch
 * limits), so the switcher names that and lists the active branches, each opening its groups; `null` when there are
 * none or this person may not manage groups.
 */
function useBranchesFor(enabled: boolean): { label: string; items: MenuItem[] } | null {
  const q = useBranches(enabled);
  const list = enabled && Array.isArray(q.data) ? q.data.filter((b) => b.is_active) : [];
  if (list.length === 0) return null;
  const label = list.length === 1 ? list[0].name : "All branches";
  const items: MenuItem[] = [
    ...list.map((b): MenuItem => ({ label: b.name, icon: "ms-branch", href: `/ops/classrooms?branch=${b.id}` })),
    "separator",
    { label: "Manage branches", icon: "sliders", href: "/ops/branches" },
  ];
  return { label, items };
}
