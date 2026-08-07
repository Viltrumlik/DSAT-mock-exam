"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  Menu,
  X,
  Search,
  Bell,
  Sun,
  Moon,
  LogOut,
  LogIn,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { IconButton } from "@/components/ui/IconButton";
import { Tooltip } from "@/components/ui/Tooltip";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  flattenNav,
  isNavItemActive,
  navGroupHasActiveChild,
  pageTitleFor,
  type NavItem,
  type NavSection,
} from "./navConfig";

const COLLAPSE_KEY = "mastersat.sidebar.collapsed";

export type AppShellBrand = { name: string; tagline?: string; logoSrc?: string };
export type AppShellUser = { name?: string; avatarUrl?: string | null } | null;

export type AppShellProps = {
  brand: AppShellBrand;
  nav: NavSection[];
  pathname: string;
  user?: AppShellUser;
  profileHref?: string;
  onSignOut?: () => void;
  onSignIn?: () => void;
  /**
   * Controls rendered in the top bar, just before the notification bell. The shell is
   * shared with the teacher portal, so anything role-specific (the student's points and
   * open surveys) is injected here rather than imported into this file.
   */
  headerSlot?: React.ReactNode;
  /** Extra rows at the top of the avatar menu — the student's points and open surveys. */
  accountMenu?: React.ReactNode;
  /** Render the notification bell. Off until there is an API behind it. */
  notifications?: boolean;
  children: React.ReactNode;
};

export function AppShell({
  brand,
  nav,
  pathname,
  user,
  profileHref = "/profile",
  onSignOut,
  onSignIn,
  headerSlot,
  accountMenu,
  notifications = false,
  children,
}: AppShellProps) {
  // `resolvedTheme`, not `theme`: with the default `system` setting, `theme` is the string
  // "system" and every comparison against "dark" is false, so the toggle showed the wrong
  // icon and moved the wrong way for anyone who had never picked a side.
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Read before the first paint rather than in an effect: an effect meant every reload
  // drew the full 272px sidebar and then snapped it to the rail.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [navQuery, setNavQuery] = useState("");
  const [cmd, setCmd] = useState("");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const cmdRef = useRef<HTMLDivElement>(null);
  const cmdInputRef = useRef<HTMLInputElement>(null);
  const acctRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setMobileOpen(false);
    setAcctOpen(false);
  }, [pathname]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (cmdRef.current && !cmdRef.current.contains(t)) setCmdOpen(false);
      if (acctRef.current && !acctRef.current.contains(t)) setAcctOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCmdOpen(false);
        setAcctOpen(false);
        return;
      }
      // The shell had no keyboard handler at all, so the one search box could only be
      // reached with the mouse. Ignore the shortcut while the caret is already in a field.
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
      if (typing) return;
      if (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        cmdInputRef.current?.focus();
        setCmdOpen(true);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const n = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, n ? "1" : "0");
      } catch {
        /* ignore */
      }
      return n;
    });

  const filteredNav = useMemo(() => {
    const q = navQuery.trim().toLowerCase();
    // `hiddenInSidebar` items are stripped here and nowhere else: the command palette and
    // the mobile page title both read the unfiltered `nav`, so those keep working.
    const matches = (i: NavItem) => !q || i.label.toLowerCase().includes(q);
    const filterItems = (items: NavItem[]): NavItem[] =>
      items.flatMap((i) => {
        if (i.hiddenInSidebar) return [];
        if (i.children && i.children.length) {
          const kids = filterItems(i.children);
          // Keep the whole group if its own label matches, else keep matching children.
          if (matches(i)) return kids.length || !q ? [{ ...i, children: kids }] : [];
          return kids.length ? [{ ...i, children: kids }] : [];
        }
        return matches(i) ? [i] : [];
      });
    return nav
      .map((s) => ({ ...s, items: filterItems(s.items) }))
      .filter((s) => s.items.length > 0);
  }, [nav, navQuery]);

  const searching = navQuery.trim().length > 0;
  // A group is open when the user has toggled it, else auto-open if it holds the
  // active route or a menu filter is active (so matches are always visible).
  const isGroupOpen = (item: NavItem) =>
    item.label in openGroups
      ? openGroups[item.label]
      : searching || navGroupHasActiveChild(item, pathname);
  const toggleGroup = (item: NavItem) =>
    setOpenGroups((m) => ({ ...m, [item.label]: !isGroupOpen(item) }));

  const cmdResults = useMemo(() => {
    const flat = flattenNav(nav);
    const q = cmd.trim().toLowerCase();
    if (!q) return flat.slice(0, 6);
    return flat.filter((i) => i.label.toLowerCase().includes(q)).slice(0, 8);
  }, [nav, cmd]);

  // Material-style click ripple for nav items (matches the design reference).
  const addRipple = (e: ReactPointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const span = document.createElement("span");
    span.className = "dz-ripple";
    span.style.cssText =
      `left:${e.clientX - rect.left}px;top:${e.clientY - rect.top}px;width:${size}px;height:${size}px`;
    el.appendChild(span);
    window.setTimeout(() => span.remove(), 600);
  };

  const title = pageTitleFor(nav, pathname, brand.name);
  const signedIn = !!user;

  const renderLeaf = (item: NavItem, opts?: { nested?: boolean }) => {
    const active = isNavItemActive(item.href, pathname);
    const Icon = item.icon;
    const link = (
      <Link
        key={item.href}
        href={item.href ?? "#"}
        onClick={() => setMobileOpen(false)}
        onPointerDown={addRipple}
        aria-current={active ? "page" : undefined}
        className={cn(
          "ds-ring group relative flex items-center gap-[13px] overflow-hidden rounded-[13px] border-[1.5px] px-3.5 py-[11px] text-[15px] font-semibold transition-[background-color,color,transform,border-color,box-shadow] duration-200 active:scale-[0.96]",
          collapsed && "md:justify-center md:px-2",
          opts?.nested && !collapsed && "ml-3 py-[9px] text-[14px]",
          active
            ? "border-primary bg-primary-soft font-bold text-primary hover:translate-x-0.5 hover:shadow-[0_6px_16px_rgba(42,104,192,0.18)]"
            : "border-border bg-transparent text-muted-foreground hover:translate-x-[3px] hover:border-primary hover:text-primary",
        )}
      >
        <Icon
          className={cn("h-5 w-5 shrink-0", active && "[animation:dz-navPop_0.4s_ease]")}
          strokeWidth={2}
        />
        {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
        {!collapsed && item.badge ? (
          <span className="ds-num grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-extrabold text-primary-foreground">
            {item.badge}
          </span>
        ) : null}
        {/* A count on a collapsed rail has nowhere to sit, so it becomes a dot. */}
        {collapsed && item.badge ? (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden />
        ) : null}
        {!collapsed && item.isNew && !item.badge ? (
          <span className="rounded-md bg-success-soft px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-success-foreground">
            New
          </span>
        ) : null}
      </Link>
    );
    return collapsed ? (
      <Tooltip key={item.href} content={item.label} side="right">
        {link}
      </Tooltip>
    ) : (
      link
    );
  };

  const renderNode = (item: NavItem): React.ReactNode => {
    if (!item.children || item.children.length === 0) return renderLeaf(item);
    // Collapsed icon rail has no room for a dropdown — surface children as flat icons.
    if (collapsed) return item.children.map((c) => renderLeaf(c));
    const open = isGroupOpen(item);
    const hasActive = navGroupHasActiveChild(item, pathname);
    const Icon = item.icon;
    return (
      <div key={item.label} className="flex flex-col gap-[7px]">
        <button
          type="button"
          onClick={() => toggleGroup(item)}
          onPointerDown={addRipple}
          aria-expanded={open}
          className={cn(
            "ds-ring group relative flex items-center gap-[13px] overflow-hidden rounded-[13px] border-[1.5px] px-3.5 py-[11px] text-left text-[15px] font-semibold transition-[background-color,color,transform,border-color,box-shadow] duration-200 active:scale-[0.96]",
            hasActive
              ? "border-border bg-surface-2 text-foreground"
              : "border-border bg-transparent text-muted-foreground hover:translate-x-[3px] hover:border-primary hover:text-primary",
          )}
        >
          <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
          <span className="flex-1 truncate">{item.label}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-200",
              open ? "rotate-0" : "-rotate-90",
            )}
            strokeWidth={2.5}
          />
        </button>
        {open ? (
          <div
            className="flex flex-col gap-[7px]"
            style={{ animation: "dz-sectionIn .3s cubic-bezier(.22,1,.36,1) both" }}
          >
            {item.children.map((c) => renderLeaf(c, { nested: true }))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="ds-app flex min-h-screen flex-col bg-background text-foreground md:h-[100dvh] md:flex-row md:overflow-hidden">
      <a
        href="#main"
        className="ds-ring sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[300] focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-bold focus:text-foreground focus:shadow-modal"
      >
        Skip to content
      </a>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-[90] bg-[var(--overlay-scrim)] md:hidden"
        />
      ) : null}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-[100] flex h-[100dvh] w-[min(100%,272px)] shrink-0 flex-col border-r border-border bg-card transition-[transform,width] duration-200 ease-[var(--ds-ease-premium)]",
          "md:relative md:z-30 md:h-full md:translate-x-0",
          collapsed ? "md:w-[4.5rem]" : "md:w-[272px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            "flex h-16 items-center gap-3 border-b border-border px-4",
            collapsed && "md:justify-center md:px-0",
          )}
        >
          {brand.logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoSrc} alt={brand.name} className="h-12 w-12 shrink-0 object-contain" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary text-sm font-extrabold text-primary-foreground">
              {brand.name.slice(0, 1)}
            </span>
          )}
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[19px] font-extrabold tracking-tight text-foreground">{brand.name}</p>
              {brand.tagline ? (
                <p className="ds-overline text-primary">{brand.tagline}</p>
              ) : null}
            </div>
          ) : null}
          <IconButton
            variant="ghost"
            size="sm"
            className="md:hidden"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        {/* Filter */}
        {!collapsed ? (
          <div className="px-3 pt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-label-foreground" />
              <input
                value={navQuery}
                onChange={(e) => setNavQuery(e.target.value)}
                placeholder="Filter menu…"
                aria-label="Filter navigation"
                className="ds-ring h-9 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-sm text-foreground placeholder:text-label-foreground focus-visible:border-primary"
              />
            </div>
          </div>
        ) : null}

        {/* Nav */}
        <nav
          aria-label="Main"
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4",
            collapsed && "md:items-center md:px-2",
          )}
        >
          {filteredNav.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No sections match.
            </p>
          ) : (
            filteredNav.map(({ section, items }, sIdx) => (
              <div
                // Index, not `section`: a reviewer's nav is `reviewNavSection` prepended to
                // the student one and BOTH have an empty section name, so keying on it gave
                // two children the same key and React warned on every render.
                key={`${sIdx}-${section}`}
                className="flex flex-col gap-[7px]"
                style={{ animation: "dz-sectionIn .42s cubic-bezier(.22,1,.36,1) both", animationDelay: `${sIdx * 60}ms` }}
              >
                {!collapsed && section ? (
                  <p className="px-3.5 pb-2 pt-[18px] text-[11px] font-extrabold uppercase tracking-[0.14em] text-label-foreground">
                    {section}
                  </p>
                ) : null}
                {items.map((item) => renderNode(item))}
              </div>
            ))
          )}
        </nav>

        {/* Footer */}
        <div className={cn("mt-auto border-t border-border p-3", collapsed && "md:px-2")}>
          {signedIn && onSignOut ? (
            <button
              type="button"
              onClick={onSignOut}
              className={cn(
                "ds-ring flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground",
                collapsed && "md:justify-center md:px-2",
              )}
            >
              <LogOut className="h-[18px] w-[18px] shrink-0" />
              {!collapsed ? "Sign out" : null}
            </button>
          ) : null}
          <IconButton
            variant="ghost"
            size="sm"
            className="mt-1 hidden w-full md:flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleCollapsed}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </IconButton>
        </div>
      </aside>

      {/* Main column. Below `md` nothing here is a scroll container — the DOCUMENT scrolls,
          which is what lets a mobile browser retract its address bar. While `main` owned the
          scroll, the bar stayed out permanently and sat over the last ~60px of every page. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        {/* Large faint brand watermark — sits behind all page content */}
        {brand.logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brand.logoSrc}
            alt=""
            aria-hidden
            className="pointer-events-none absolute -bottom-20 -right-16 z-0 w-[min(55vw,560px)] select-none opacity-[0.045] dark:opacity-[0.07]"
          />
        ) : null}
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 backdrop-blur md:gap-4 md:px-6">
          <IconButton
            variant="ghost"
            className="md:hidden"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </IconButton>

          <div ref={cmdRef} className="relative hidden min-w-0 max-w-md flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-label-foreground" />
            <input
              ref={cmdInputRef}
              value={cmd}
              onChange={(e) => {
                setCmd(e.target.value);
                setCmdOpen(true);
              }}
              onFocus={() => setCmdOpen(true)}
              placeholder="Search pages…   /"
              aria-label="Search pages"
              aria-keyshortcuts="/ Meta+K Control+K"
              className="ds-ring h-10 w-full rounded-xl border border-border bg-surface-2 pl-9 pr-3 text-sm text-foreground placeholder:text-label-foreground focus-visible:border-primary"
            />
            {cmdOpen && cmdResults.length > 0 ? (
              <ul className="ds-anim-fade absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-72 overflow-auto rounded-xl border border-border bg-card py-1 shadow-modal">
                {cmdResults.map((r) => (
                  <li key={r.href ?? r.label}>
                    <Link
                      href={r.href ?? "#"}
                      onClick={() => {
                        setCmdOpen(false);
                        setCmd("");
                      }}
                      className="flex items-center gap-2.5 px-3 py-2 text-sm text-foreground transition-colors hover:bg-surface-2"
                    >
                      <r.icon className="h-4 w-4 text-label-foreground" />
                      {r.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <p className="truncate text-base font-bold tracking-tight md:hidden">{title}</p>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2">
            {headerSlot}

            {/* The bell only appears where it can tell the truth. It used to render an
                unread dot unconditionally with no data behind it, and opening it always
                said "You're all caught up" — the loudest permanent control in the product,
                never once connected to anything. It comes back when there is a
                notifications API. */}
            {notifications ? (
              <Tooltip content="Notifications" side="bottom">
                <IconButton
                  variant="ghost"
                  aria-label="Notifications"
                  aria-expanded={notifOpen}
                  onClick={() => setNotifOpen(true)}
                  className="relative"
                >
                  <Bell className="h-5 w-5" />
                </IconButton>
              </Tooltip>
            ) : null}

            {/* Theme moves into the account menu: a set-once preference should not be the
                loudest button on every page, and mobile needs the 40px back. */}
            {mounted ? (
              // The responsive class sits on a wrapper, not on IconButton: `lib/cn` is a
              // plain join rather than tailwind-merge, so a `hidden` passed through
              // `className` merely joins the component's own `inline-flex` and loses on
              // stylesheet order.
              <span className="hidden md:block">
                <Tooltip content={resolvedTheme === "dark" ? "Light mode" : "Dark mode"} side="bottom">
                  <IconButton
                    variant="ghost"
                    aria-label="Toggle theme"
                    onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                  >
                    {resolvedTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                  </IconButton>
                </Tooltip>
              </span>
            ) : null}

            {signedIn ? (
              <div className="relative" ref={acctRef}>
                <button
                  type="button"
                  aria-label="Your account"
                  aria-haspopup="menu"
                  aria-expanded={acctOpen}
                  onClick={() => setAcctOpen((o) => !o)}
                  className="ds-ring rounded-full"
                >
                  <Avatar src={user?.avatarUrl} name={user?.name} size={38} />
                </button>
                {acctOpen ? (
                  <div
                    role="menu"
                    className="ds-anim-fade absolute right-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-modal"
                  >
                    {user?.name ? (
                      <p className="truncate px-3 pb-2 pt-1.5 text-sm font-bold text-foreground">
                        {user.name}
                      </p>
                    ) : null}
                    {accountMenu}
                    <Link
                      role="menuitem"
                      href={profileHref}
                      onClick={() => setAcctOpen(false)}
                      className="flex items-center gap-2.5 border-t border-border px-3 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2"
                    >
                      <UserRound className="h-4 w-4 text-muted-foreground" />
                      Profile
                    </Link>
                    {mounted ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 md:hidden"
                      >
                        {resolvedTheme === "dark" ? (
                          <Sun className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Moon className="h-4 w-4 text-muted-foreground" />
                        )}
                        {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
                      </button>
                    ) : null}
                    {onSignOut ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAcctOpen(false);
                          onSignOut();
                        }}
                        className="flex w-full items-center gap-2.5 border-t border-border px-3 py-2.5 text-left text-sm font-semibold text-foreground transition-colors hover:bg-surface-2"
                      >
                        <LogOut className="h-4 w-4 text-muted-foreground" />
                        Sign out
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : onSignIn ? (
              <button
                type="button"
                onClick={onSignIn}
                className="ds-ring inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover md:px-4"
              >
                <LogIn className="h-4 w-4" />
                <span className="hidden sm:inline">Sign in</span>
              </button>
            ) : null}
          </div>
        </header>

        <main
          id="main"
          className="relative z-10 min-h-0 flex-1 px-3 py-5 md:overflow-y-auto md:px-6 lg:px-8"
        >
          {children}
        </main>
      </div>

      {/* Notifications — bell opens a drawer (not a primary nav item) */}
      <Drawer
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        title="Notifications"
      >
        <EmptyState
          compact
          icon={Bell}
          title="You're all caught up"
          description="Grades, assignments, and reminders will appear here."
        />
      </Drawer>
    </div>
  );
}
