"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { OpsSidebar } from "./OpsSidebar";
import { OpsTopBar } from "./OpsTopBar";
import { OPS_NAV_GROUPS, visibleNav } from "./opsNav";

const COLLAPSE_KEY = "mastersat.ops.sidebar.collapsed";

/** `useMe` types the payload as an open record, so the fields are narrowed here. */
type MeLike = Record<string, unknown> | null | undefined;

/**
 * The ops console's frame, after Django admin: a sidebar stuck to the left edge, a thin top bar,
 * and the page across the rest of the window — no centred box, no card around the nav.
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
}: {
  pathname: string;
  me: MeLike;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);

  const groups = useMemo(() => visibleNav(OPS_NAV_GROUPS, me), [me]);

  // Navigating closes the drawer (the links also close it on click; this covers back/forward).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* storage blocked — the choice just isn't remembered */
      }
      return next;
    });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#ops-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-2 focus:z-50 focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>

      {mobileOpen ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-[var(--overlay-scrim)] lg:hidden"
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
      />

      {/* No z-index here on purpose: a stacking context on this column would trap the pages'
          own `fixed z-50` dialogs beneath the sidebar. */}
      <div
        className={cn(
          "flex min-h-screen min-w-0 flex-col transition-[padding] duration-200 ease-out",
          collapsed ? "lg:pl-16" : "lg:pl-60",
        )}
      >
        <OpsTopBar
          pathname={pathname}
          me={me}
          mobileOpen={mobileOpen}
          onOpenMobile={() => setMobileOpen(true)}
          menuButtonRef={menuButtonRef}
        />
        <main id="ops-main" className="min-w-0 flex-1 px-4 py-4 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
