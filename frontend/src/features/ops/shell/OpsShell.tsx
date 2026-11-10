"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { CommandPalette } from "@/features/console/CommandPalette";
import { consoleCommands } from "@/features/console/commands";
import { consoleHref } from "@/features/console/consoleHref";
import { isScopedOpsAdmin } from "@/features/ops/adminScope";
import { useLcupFollowups } from "@/features/lcup/lcupHooks";
import { cn } from "@/lib/cn";
import { OpsSidebar } from "./OpsSidebar";
import { OpsTopBar } from "./OpsTopBar";
import { OPS_CONSOLE, isOpsSuperAdmin, type ConsoleConfig, type MeLike } from "./opsNav";

/**
 * The consoles' frame (design handoff v0.3, Shell board): a grouped menu stuck to the left edge, a
 * top bar, and the page across the rest of the window, up to 1600 px.
 *
 * Its root is the console surface (`.ms`): the redesign's tokens, Geist instead of the body's
 * reading serif, the neutral background. The builder (questions.mastersat.uz) wears the same frame
 * with its own `config` — its nav, its name, its home — and the rounder Builder temperature.
 *
 * Mounted inside AuthGuard, which renders nothing of its children until `/users/me` has loaded,
 * so this never renders on the server and the collapse preference can be read before the first
 * paint (an effect would draw the full sidebar and then snap it to the rail).
 *
 * The DOCUMENT scrolls, not a pane: the sidebar is `fixed` and the content column is padded
 * clear of it, so the top bar's `sticky` works and a phone can retract its address bar.
 */
export function OpsShell({
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
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(config.collapseKey) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);

  const groups = useMemo(() => config.visible(config.groups, me), [config, me]);

  // The Trials count — for an administrator only, the one role its API answers.
  const wantsTrials = useMemo(() => groups.some((g) => g.items.some((i) => i.countKey === "trials")), [groups]);
  const followups = useLcupFollowups({ enabled: wantsTrials && (isOpsSuperAdmin(me) || isScopedOpsAdmin(me)) });
  const counts = useMemo(() => ({ trials: followups.data?.pending ?? 0 }), [followups.data]);

  // The other console, for the top bar's switch and ⌘K. Both admit the same roles (AuthGuard adminOnly).
  const other = config.temp === "builder" ? "admin" : "builder";
  const otherConsole = useMemo(
    () => ({
      label: other === "admin" ? "Admin" : "Builder",
      href: consoleHref(other, typeof window === "undefined" ? { protocol: "http:", host: "" } : window.location),
    }),
    [other],
  );

  // ⌘K: every page in the menu this person sees, then a few actions.
  const [searchOpen, setSearchOpen] = useState(false);
  const { setTheme } = useTheme();
  const commands = useMemo(
    () =>
      consoleCommands(groups, [
        { id: "switch", label: `Switch to ${otherConsole.label}`, group: "Actions", icon: "switch", href: otherConsole.href, keywords: ["console"] },
        { id: "theme-light", label: "Light theme", group: "Actions", icon: "sun", run: () => setTheme("light") },
        { id: "theme-dark", label: "Dark theme", group: "Actions", icon: "moon", run: () => setTheme("dark") },
        { id: "theme-system", label: "System theme", group: "Actions", icon: "monitor", run: () => setTheme("system") },
      ]),
    [groups, otherConsole, setTheme],
  );

  const toggleCollapsed = useCallback(
    () =>
      setCollapsed((c) => {
        const next = !c;
        try {
          window.localStorage.setItem(config.collapseKey, next ? "1" : "0");
        } catch {
          /* storage blocked — the choice just isn't remembered */
        }
        return next;
      }),
    [config.collapseKey],
  );

  // Navigating closes the drawer (the links also close it on click; this covers back/forward).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // `[` folds the rail and opens it again (Shell board), unless the person is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      e.preventDefault();
      toggleCollapsed();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Focus follows the drawer: into it on open, back to the hamburger on close.
  useEffect(() => {
    if (mobileOpen) {
      closeButtonRef.current?.focus();
    } else if (wasOpen.current) {
      menuButtonRef.current?.focus();
    }
    wasOpen.current = mobileOpen;
  }, [mobileOpen]);


  return (
    <div className="ms min-h-screen" data-ms-temp={config.temp === "builder" ? "builder" : undefined}>
      <a
        href="#ops-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-2 focus:z-50 focus:rounded-full focus:bg-ms-inverse-bg focus:px-4 focus:py-2 focus:text-[14px] focus:font-semibold focus:text-ms-inverse-fg"
      >
        Skip to content
      </a>

      {mobileOpen ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="animate-ms-scrim-in fixed inset-0 z-30 bg-ms-scrim lg:hidden"
        />
      ) : null}

      <OpsSidebar
        groups={groups}
        pathname={pathname}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onToggleCollapsed={toggleCollapsed}
        closeButtonRef={closeButtonRef}
        config={config}
        counts={counts}
      />

      {/* No z-index here on purpose: a stacking context on this column would trap the pages'
          own `fixed z-50` dialogs beneath the sidebar. */}
      <div
        className={cn(
          "flex min-h-screen min-w-0 flex-col transition-[padding] duration-200 ease-ms-out",
          collapsed ? "lg:pl-(--ms-rail)" : "lg:pl-(--ms-sidebar)",
        )}
      >
        <OpsTopBar
          pathname={pathname}
          me={me}
          mobileOpen={mobileOpen}
          onOpenMobile={() => setMobileOpen(true)}
          menuButtonRef={menuButtonRef}
          onOpenSearch={() => setSearchOpen(true)}
          otherConsole={otherConsole}
          config={config}
        />
        <main id="ops-main" className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6 xl:px-8">
          <div className="mx-auto w-full max-w-(--ms-content-max)">{children}</div>
        </main>
      </div>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} commands={commands} />
    </div>
  );
}
