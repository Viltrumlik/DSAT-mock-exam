"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";

import { Icon, type IconName } from "@/components/ui/Icon";
import { authApi } from "@/lib/api";
import { avatarTone, displayName, initials, isReadOnly, roleLabel, type MeLike } from "./person";

/** Literal class names so Tailwind sees them: the six muted avatar tones. */
const TONE = {
  1: "bg-ms-av1-bg text-ms-av1-fg",
  2: "bg-ms-av2-bg text-ms-av2-fg",
  3: "bg-ms-av3-bg text-ms-av3-fg",
  4: "bg-ms-av4-bg text-ms-av4-fg",
  5: "bg-ms-av5-bg text-ms-av5-fg",
  6: "bg-ms-av6-bg text-ms-av6-fg",
} as const;

const THEMES: { value: "light" | "dark" | "system"; label: string; icon: IconName }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
];

function ReadOnlyBadge() {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-ms-neutral-soft px-2 text-[12px] font-semibold text-ms-neutral-fg">
      <Icon name="eye" size="sm" />
      Read-only
    </span>
  );
}

/**
 * The person in the top bar (design handoff v0.3, Shell board): initials, name and role, and a menu
 * with the theme, the keyboard shortcuts and Log out. A menu button (WAI-ARIA APG): opening focuses
 * the first item, arrows move, Escape closes and focus returns to the button. An auditor sees a
 * "Read-only" badge beside their name.
 */
export function UserMenu({ me }: { me: MeLike }) {
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const name = displayName(me);
  const role = roleLabel(me);
  const readOnly = isReadOnly(me);

  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];

  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onMenuKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      list[(at + step + list.length) % list.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      (e.key === "Home" ? list[0] : list[list.length - 1])?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const itemClass =
    "ms-transition flex min-h-10 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[15px] text-ms-fg outline-none hover:bg-ms-surface-2 focus-visible:bg-ms-surface-2";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={[name, role, readOnly ? "read-only" : ""].filter(Boolean).join(", ")}
        onClick={() => setOpen((o) => !o)}
        className="ms-transition flex min-h-11 items-center gap-2.5 rounded-full py-1 pl-1 pr-1 hover:bg-ms-surface-2 md:pr-2.5"
      >
        <span className={`grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold tracking-[.02em] ${TONE[avatarTone(me)]}`}>
          {initials(me)}
        </span>
        <span className="hidden min-w-0 flex-col text-left leading-tight md:flex">
          <span className="max-w-[14rem] truncate text-[14px] font-semibold text-ms-fg">{name}</span>
          <span className="text-[12px] text-ms-fg-3">{role}</span>
        </span>
        {readOnly ? (
          <span className="hidden lg:inline-flex">
            <ReadOnlyBadge />
          </span>
        ) : null}
        <Icon name="down" size="sm" className="hidden text-ms-fg-3 md:block" />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKey}
          className="animate-ms-fade-in absolute right-0 top-full z-50 mt-2 w-72 rounded-ms-pop border border-ms-border bg-ms-card p-1.5 shadow-ms-2"
        >
          <div role="none" className="flex flex-col gap-1 px-2.5 pb-2.5 pt-2">
            <span className="truncate text-[15px] font-semibold text-ms-fg">{name}</span>
            <span className="flex items-center gap-2 text-[13px] text-ms-fg-3">
              {role}
              {readOnly ? <ReadOnlyBadge /> : null}
            </span>
          </div>
          <div role="separator" className="-mx-1.5 my-1.5 h-px bg-ms-border" />

          <div role="none" className="px-2.5 pb-1 pt-1.5 text-[13px] font-semibold text-ms-fg-3">Theme</div>
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === t.value}
              tabIndex={-1}
              onClick={() => {
                setTheme(t.value);
                close();
              }}
              className={itemClass}
            >
              <Icon name={t.icon} className="text-ms-fg-2" />
              {t.label}
              {theme === t.value ? <Icon name="check" size="sm" className="ml-auto text-ms-primary-text" /> : null}
            </button>
          ))}

          <div role="separator" className="-mx-1.5 my-1.5 h-px bg-ms-border" />
          <div role="none" className="px-2.5 pb-1 pt-1.5 text-[13px] font-semibold text-ms-fg-3">Keyboard</div>
          <div role="none" className="flex flex-col gap-1 px-2.5 pb-1.5 text-[14px] text-ms-fg-2">
            <span className="flex items-center justify-between">
              Search pages
              <kbd className="rounded-[6px] border border-ms-border-strong px-1.5 font-ms-mono text-[12px] text-ms-fg-2">⌘ K</kbd>
            </span>
            <span className="flex items-center justify-between">
              Fold the menu
              <kbd className="rounded-[6px] border border-ms-border-strong px-1.5 font-ms-mono text-[12px] text-ms-fg-2">[</kbd>
            </span>
          </div>

          <div role="separator" className="-mx-1.5 my-1.5 h-px bg-ms-border" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={loggingOut || undefined}
            onClick={() => {
              if (loggingOut) return;
              setLoggingOut(true);
              void authApi.logout(queryClient);
            }}
            className={itemClass}
          >
            <Icon name="logout" className="text-ms-fg-2" />
            {loggingOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
