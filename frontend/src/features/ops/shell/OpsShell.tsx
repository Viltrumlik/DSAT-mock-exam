"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { CommandPalette } from "@/features/console/CommandPalette";
import { ShortcutsDialog } from "@/features/console/ShortcutsDialog";
import { Toaster } from "@/features/console/toast";
import { usePresence } from "@/features/console/ui/presence";
import { useAdminAttention, useBuilderAttention } from "@/features/console/attention";
import { consoleCommands, pinCommands } from "@/features/console/commands";
import { entityScope } from "@/features/console/entitySearch";
import { canOpenConsole, consoleHref } from "@/features/console/consoleHref";
import { PageOutlineProvider, usePublishedTabs } from "@/features/console/pageOutline";
import { displayName, roleLabel } from "@/features/console/person";
import { useRecent } from "@/features/console/recent";
import { isScopedOpsAdmin } from "@/features/ops/adminScope";
import { useLcupFollowups } from "@/features/lcup/lcupHooks";
import { cn } from "@/lib/cn";
import { OpsTopBar } from "./OpsTopBar";
import { PanelBody, type PanelProps } from "./Panel";
import { CategorySheet, PhoneTabBar } from "./PhoneNav";
import { RAIL_ID, Rail } from "./Rail";
import {
  OPS_CONSOLE,
  categoryOf,
  crumbsFor,
  firstHref,
  isOpsSuperAdmin,
  visibleCategories,
  type ConsoleCategory,
  type ConsoleConfig,
  type MeLike,
} from "./opsNav";
import { attentionItems, categoryFlags, groupLine, pageCounts } from "./shellModel";
import { togglePin, useFolds, usePins } from "./shellStore";

export const PANEL_ID = "ops-panel";
export const FLYOUT_ID = "ops-flyout";

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

const tashkentDay = (now = new Date()) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", weekday: "short", day: "numeric", month: "short" }).format(now).replace(",", "");

/**
 * The consoles' frame (design handoff v0.4, Shell board — "Six categories. Sub-categories inside. Nothing to
 * scroll."): a dark category rail at the left edge, the sub-category panel of the category you are in beside it, a
 * top bar, and the page across the rest of the window, up to 1600 px.
 *
 * One structure, four layouts:
 * - ≥ 1440 px: rail + panel pinned (the default); `[` folds the panel and the choice is remembered;
 * - 1024–1439 px: rail + flyout — hovering or focusing a category floats its panel over the page (a tap on touch),
 *   and a choice closes it; `[` pins the panel here too;
 * - 768–1023 px: rail only — tapping a category opens its panel as a sheet from the left;
 * - below 768 px: the bottom tab bar, and the open category's sheet of tiles.
 *
 * Its root is the console surface (`.ms`): the redesign's tokens, Geist instead of the body's reading serif, the
 * neutral background. The builder (questions.mastersat.uz) wears the same frame with its own `config` — its map, its
 * name, its home — and the rounder Builder temperature.
 *
 * Mounted inside AuthGuard, which renders nothing of its children until `/users/me` has loaded, so this never
 * renders on the server and the panel preference is read before the first paint.
 *
 * The DOCUMENT scrolls, not a pane: the rail and panel are `fixed` and the content column is padded clear of them,
 * so the top bar's `sticky` works and a phone can retract its address bar.
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
  const userId = me?.id;

  // ── What this person may open, and where they are ────────────────────────────────────────────────────────────
  const categories = useMemo(() => visibleCategories(config.categories, me, config.visible), [config, me]);
  const found = categoryOf(pathname, categories);
  const activeCategory: ConsoleCategory | null = found?.category ?? null;
  const activeHref = found?.item.href ?? null;
  const published = usePublishedTabs(pathname);
  const recent = useRecent(scope);

  // ── Numbers: the Trials count, and "Needs you" (the bell's) for the flags and the page counts ───────────────────
  const wantsTrials = useMemo(() => categories.some((c) => c.groups.some((g) => g.items.some((i) => i.countKey === "trials"))), [categories]);
  const followups = useLcupFollowups({ enabled: wantsTrials && (isOpsSuperAdmin(me) || isScopedOpsAdmin(me)) });
  const keyed = useMemo(() => ({ trials: followups.data?.pending ?? 0 }), [followups.data]);
  // Admin's only for super admins and admins, whom every one of its endpoints admits; the Builder's for everyone in it.
  const adminAttention = useAdminAttention(config.temp === "admin" && (isOpsSuperAdmin(me) || isScopedOpsAdmin(me)));
  // On Studio home the bell shares the page's summary (same key, recents included); elsewhere a stable one.
  const builderAttention = useBuilderAttention(config.temp === "builder" && Boolean(me), pathname === "/builder");
  const attention = config.temp === "builder" ? builderAttention : adminAttention;
  const items = useMemo(() => attentionItems(attention), [attention]);
  const flags = useMemo(() => categoryFlags(items, categories), [items, categories]);
  const counts = useMemo(() => pageCounts(items, categories), [items, categories]);

  // ── Pins and folds, per person, in this browser ──────────────────────────────────────────────────────────────
  const [pins, setPins] = usePins(scope, userId);
  const [folded, toggleFold] = useFolds(scope, userId);

  // ── Where you are: the breadcrumb, and this page as a pin ───────────────────────────────────────────────────
  const detail = recent.find((r) => r.href === pathname)?.name ?? null;
  const crumbs = crumbsFor(pathname, {
    categories,
    root: config.root,
    rootLabel: config.crumb,
    tabs: published?.tabs ?? null,
    tab: published?.value ?? null,
    detail,
  });
  const tabbed = Boolean(published && published.tabs.length > 0 && published.value !== published.tabs[0].id);
  const here = {
    href: tabbed && published ? `${pathname}?tab=${encodeURIComponent(published.value)}` : pathname,
    label: crumbs[crumbs.length - 1]?.label ?? "",
    icon: found?.item.icon ?? ("bookmark" as const),
  };
  const pin = here.label ? { pinned: pins.some((p) => p.href === here.href), count: pins.length, onToggle: () => setPins(togglePin(pins, here)) } : null;

  // ── The other console, for the rail's pill and ⌘K ───────────────────────────────────────────────────────────
  // Only when this person may open it (a test admin is kept to the Builder by AuthGuard, so they get no Admin).
  const other = config.temp === "builder" ? "admin" : "builder";
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

  // ── ⌘K: pins first, then every page this person may open (hinted with its category), then actions ──────────
  const entityKinds = useMemo(() => entityScope(config.temp, me), [config.temp, me]);
  const [searchOpen, setSearchOpen] = useState(false);
  const { setTheme } = useTheme();
  const commands = useMemo(
    () => [
      ...pinCommands(pins),
      ...consoleCommands(
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
    ],
    [pins, categories, otherConsole, setTheme],
  );

  // ── Layout: pinned panel or flyout (remembered), tablet sheet, phone sheet ──────────────────────────────────
  const desktop = useMedia("(min-width: 1024px)", true);
  const wide = useMedia("(min-width: 1440px)", true);
  const [pref, setPref] = useState<"0" | "1" | null>(() => {
    try {
      const v = window.localStorage.getItem(config.collapseKey);
      return v === "1" || v === "0" ? v : null;
    } catch {
      return null;
    }
  });
  const panelPinned = pref === "1" ? false : pref === "0" ? true : wide;
  const toggleCollapsed = useCallback(() => {
    const next = panelPinned ? "1" : "0";
    setPref(next);
    try {
      window.localStorage.setItem(config.collapseKey, next);
    } catch {
      /* storage blocked — the choice just isn't remembered */
    }
  }, [panelPinned, config.collapseKey]);

  const [peek, setPeek] = useState<{ id: string; how: "hover" | "focus" | "tap" } | null>(null);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [phoneSheet, setPhoneSheet] = useState<string | null>(null);
  const phoneOpener = useRef<HTMLElement | null>(null);
  const timer = useRef<number | null>(null);

  // Going somewhere closes whatever floats.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setPeek(null);
    setSheetFor(null);
    setPhoneSheet(null);
  }

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clearTimer, [clearTimer]);
  const flyoutMode = desktop && !panelPinned;

  const onPeek = (id: string, how: "hover" | "focus") => {
    if (!flyoutMode) return;
    clearTimer();
    const c = categories.find((x) => x.id === id);
    if (!c || c.home) {
      if (how === "hover") timer.current = window.setTimeout(() => setPeek(null), 160);
      else setPeek(null);
      return;
    }
    if (how === "hover") timer.current = window.setTimeout(() => setPeek({ id, how }), peek ? 0 : 90);
    else setPeek({ id, how });
  };
  const onLeave = () => {
    clearTimer();
    timer.current = window.setTimeout(() => setPeek((p) => (p && p.how === "hover" ? null : p)), 220);
  };
  const onTap = (id: string, pointer: string): boolean => {
    const c = categories.find((x) => x.id === id);
    if (!c) return false;
    if (!desktop) {
      // Tablet: a category opens its panel as a sheet; Today / Studio home go straight to the page.
      if (c.home) return false;
      setSheetFor((s) => (s === id ? null : id));
      return true;
    }
    if (flyoutMode && pointer !== "mouse" && !c.home && peek?.id !== id) {
      setPeek({ id, how: "tap" });
      return true;
    }
    setPeek(null);
    return false;
  };

  // ── Keys: `[` folds or pins the panel; G then a letter jumps to a category; → enters the flyout; Esc closes ──
  const gAt = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "Escape") {
        if (peek || sheetFor) {
          const id = peek?.id ?? sheetFor;
          const back = peek?.how === "focus" || sheetFor ? document.querySelector<HTMLElement>(`#${RAIL_ID} [data-category="${id}"]`) : null;
          setPeek(null);
          setSheetFor(null);
          back?.focus();
        }
        return;
      }
      if (e.key === "ArrowRight" && peek && (e.target as HTMLElement | null)?.closest?.(`#${RAIL_ID}`)) {
        const first = document.querySelector<HTMLElement>(`#${FLYOUT_ID} a, #${FLYOUT_ID} button`);
        if (first) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        toggleCollapsed();
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
  }, [toggleCollapsed, categories, router, peek, sheetFor]);

  // Keyboard focus that leaves the rail and the flyout closes it; so does a tap or click outside them.
  useEffect(() => {
    if (!peek) return;
    const inside = (t: EventTarget | null) => {
      const n = t as Node | null;
      return Boolean(n && (document.getElementById(RAIL_ID)?.contains(n) || document.getElementById(FLYOUT_ID)?.contains(n)));
    };
    const onFocus = (e: FocusEvent) => {
      if (!inside(e.target)) setPeek(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) setPeek(null);
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [peek]);

  // ── The panel's content, for whichever category it shows ────────────────────────────────────────────────────
  const subline = (c: ConsoleCategory) =>
    c.home ? (config.temp === "builder" ? [displayName(me), roleLabel(me)] : [tashkentDay(), roleLabel(me)]).filter(Boolean).join(" · ") : groupLine(c);
  const panelFor = (c: ConsoleCategory, variant: PanelProps["variant"], extra: Partial<PanelProps> = {}): PanelProps => ({
    category: c,
    variant,
    pathname,
    activeHref: c.id === activeCategory?.id ? activeHref : null,
    published: c.id === activeCategory?.id ? published : null,
    counts,
    keyed,
    pins,
    onPinsChange: setPins,
    folded,
    onToggleFold: toggleFold,
    recent,
    subline: subline(c),
    temp: config.temp,
    ...extra,
  });
  const pinnedCategory = activeCategory ?? categories[0] ?? null;

  // The flyout keeps showing its category while it leaves.
  const flyout = usePresence(Boolean(peek));
  const [flyId, setFlyId] = useState<string | null>(null);
  if (peek && peek.id !== flyId) setFlyId(peek.id);
  const flyCategory = categories.find((c) => c.id === flyId) ?? null;
  const flyRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!peek) return;
    const tile = document.querySelector<HTMLElement>(`#${RAIL_ID} [data-category="${peek.id}"]`);
    const el = flyRef.current;
    if (!tile || !el) return;
    const top = tile.getBoundingClientRect().top - 8;
    const max = window.innerHeight - el.offsetHeight - 12;
    el.style.top = `${Math.max(12, Math.min(top, max))}px`;
  }, [peek, flyId]);

  const sheet = usePresence(sheetFor !== null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  if (sheetFor && sheetFor !== sheetId) setSheetId(sheetFor);
  const sheetCategory = categories.find((c) => c.id === sheetId) ?? null;
  const sheetBox = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (sheetFor) sheetBox.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [sheetFor]);

  const closePhoneSheet = useCallback(() => {
    setPhoneSheet(null);
    phoneOpener.current?.focus();
  }, [setPhoneSheet]);

  const panelSurface = config.temp === "builder" ? "bg-ms-surface" : "bg-ms-card";

  return (
    <div className="ms min-h-screen" data-ms-temp={config.temp === "builder" ? "builder" : undefined} data-panel={panelPinned ? "pinned" : "flyout"}>
      <a
        href="#ops-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-2 focus:z-50 focus:rounded-full focus:bg-ms-inverse-bg focus:px-4 focus:py-2 focus:text-[14px] focus:font-semibold focus:text-ms-inverse-fg"
      >
        Skip to content
      </a>
      <Toaster />
      <ShortcutsDialog />

      <Rail
        config={config}
        categories={categories}
        activeId={activeCategory?.id ?? null}
        peekId={peek?.id ?? sheetFor}
        flags={flags}
        me={me}
        otherConsole={otherConsole}
        onSearch={() => setSearchOpen(true)}
        onPeek={onPeek}
        onLeave={onLeave}
        onTap={onTap}
      />

      {/* ≥ 1024 px, pinned: the panel of the category you are in, beside the rail. */}
      {panelPinned && pinnedCategory ? (
        <nav
          id={PANEL_ID}
          aria-label={pinnedCategory.label}
          className={cn("fixed inset-y-0 left-(--ms-rail) z-30 hidden w-(--ms-subnav) flex-col border-r border-ms-border px-3 pb-3.5 pt-[18px] lg:flex", panelSurface)}
        >
          <PanelBody {...panelFor(pinnedCategory, "pinned", { onCollapse: toggleCollapsed })} />
        </nav>
      ) : null}

      {/* Folded: the hovered / focused / tapped category's panel floats beside the rail. */}
      {flyoutMode && flyout.mounted && flyCategory ? (
        <nav
          id={FLYOUT_ID}
          ref={flyRef}
          aria-label={flyCategory.label}
          onPointerEnter={clearTimer}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") onLeave();
          }}
          className={cn(
            "fixed left-[calc(var(--ms-rail)+10px)] top-16 z-50 flex max-h-[calc(100vh-24px)] w-[260px] origin-left flex-col rounded-[22px] bg-ms-card px-3 pb-3 pt-4 shadow-ms-3",
            flyout.closing ? "animate-ms-dialog-out pointer-events-none" : "animate-ms-dialog-in",
          )}
        >
          <PanelBody {...panelFor(flyCategory, "flyout", { onClose: () => setPeek(null) })} />
        </nav>
      ) : null}

      {/* 768–1023 px: a category's panel as a sheet from the left, over the page. */}
      {!desktop && sheet.mounted && sheetCategory ? (
        <div className="hidden md:block lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close menu"
            onClick={() => setSheetFor(null)}
            className={cn("fixed inset-0 left-(--ms-rail) z-30 bg-ms-scrim", sheet.closing ? "animate-ms-scrim-out pointer-events-none" : "animate-ms-scrim-in")}
          />
          <nav
            ref={sheetBox}
            aria-label={sheetCategory.label}
            className={cn(
              "fixed inset-y-0 left-(--ms-rail) z-40 flex w-[min(300px,calc(100vw-var(--ms-rail)))] flex-col bg-ms-card px-3 pb-3.5 pt-[18px] shadow-ms-3",
              sheet.closing ? "animate-ms-sheet-out-left pointer-events-none" : "animate-ms-sheet-in-left",
            )}
          >
            <PanelBody {...panelFor(sheetCategory, "sheet", { onClose: () => setSheetFor(null) })} />
          </nav>
        </div>
      ) : null}

      {/* No z-index here on purpose: a stacking context on this column would trap the pages'
          own `fixed z-50` dialogs beneath the rail. */}
      <div
        className={cn(
          "flex min-h-screen min-w-0 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] transition-[padding] duration-200 ease-ms-out md:pb-0 md:pl-(--ms-rail)",
          panelPinned && "lg:pl-[calc(var(--ms-rail)+var(--ms-subnav))]",
        )}
      >
        <OpsTopBar
          crumbs={crumbs}
          me={me}
          onOpenSearch={() => setSearchOpen(true)}
          attention={attention}
          searchLabel={`Search ${[...entityKinds.map((k) => k.toLowerCase()), "pages"].join(", ")}…`}
          pin={pin}
        />
        <main id="ops-main" className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6 xl:px-8">
          <div className="mx-auto w-full max-w-(--ms-content-max)">{children}</div>
        </main>
      </div>

      <PhoneTabBar
        label={config.crumb}
        categories={categories}
        activeId={activeCategory?.id ?? null}
        flags={flags}
        sheetFor={phoneSheet}
        onOpenSheet={(id, from) => {
          phoneOpener.current = from;
          setPhoneSheet((s) => (s === id ? null : id));
        }}
      />
      <CategorySheet sheetFor={phoneSheet} categories={categories} activeHref={activeHref} pins={pins} counts={counts} keyed={keyed} onClose={closePhoneSheet} />

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} commands={commands} entityKinds={entityKinds} />
    </div>
  );
}
