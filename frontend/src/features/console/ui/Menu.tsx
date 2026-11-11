"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { buttonClass, type ButtonVariant } from "./Button";
import { usePresence } from "./presence";

export type MenuItem =
  | "separator"
  | {
      label: string;
      icon?: IconName;
      shortcut?: string;
      danger?: boolean;
      /** A disabled item says why, under its name (Overlays board: "lc-up runs this class — move him there"). */
      disabledReason?: string;
      href?: string;
      onSelect?: () => void;
    };

/**
 * A menu button (design handoff v0.3, Overlays board; WAI-ARIA menu button): opening focuses the
 * first item; ↑ ↓ Home End move; Enter picks; Esc or a click outside closes and returns focus. It
 * fades in under its button and out again.
 */
export function Menu({
  label,
  items,
  icon = "more",
  text,
  variant = "ghost",
  align = "end",
}: {
  /** The button's name: "Actions for Bekzod Jo'rayev". */
  label: string;
  items: MenuItem[];
  icon?: IconName;
  /** Words on the button; without them it is a square icon button. */
  text?: string;
  variant?: ButtonVariant;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const { mounted, closing } = usePresence(open, 120);
  const id = useId();
  const button = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const enabled = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];

  useEffect(() => {
    if (!open) return;
    enabled()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = enabled();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      close(e.key === "Escape");
    }
  };

  return (
    <span className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={text ? undefined : label}
        onClick={() => setOpen((o) => !o)}
        className={buttonClass({ variant, size: "sm", square: !text, className: text ? "gap-1.5" : undefined })}
      >
        <Icon name={icon} size="sm" />
        {text}
      </button>
      {mounted ? (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={cn(
            "absolute top-full z-50 mt-2 w-max min-w-[220px] max-w-[320px] rounded-ms-pop border border-ms-border bg-ms-card p-1.5 shadow-ms-2",
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            closing ? "animate-ms-dialog-out" : "animate-ms-dialog-in",
          )}
        >
          {items.map((item, i) => {
            if (item === "separator") return <div key={`sep-${i}`} role="separator" className="-mx-1.5 my-1.5 h-px bg-ms-border" />;
            const disabled = Boolean(item.disabledReason);
            const cls = cn(
              "ms-transition flex w-full min-h-10 items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[15px] leading-5 outline-none",
              disabled ? "cursor-not-allowed text-ms-fg-disabled" : item.danger ? "text-ms-critical-fg hover:bg-ms-surface-2 focus:bg-ms-surface-2" : "text-ms-fg hover:bg-ms-surface-2 focus:bg-ms-surface-2",
            );
            const body = (
              <>
                {item.icon ? <Icon name={item.icon} size="sm" className="shrink-0" /> : <span className="w-4 shrink-0" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{item.label}</span>
                  {item.disabledReason ? <span className="text-[13px] leading-[18px] text-ms-fg-3">{item.disabledReason}</span> : null}
                </span>
                {item.shortcut ? <kbd className="ml-auto pl-3 font-ms-mono text-[12px] text-ms-fg-3">{item.shortcut}</kbd> : null}
              </>
            );
            return item.href && !disabled ? (
              <Link key={item.label} href={item.href} role="menuitem" tabIndex={-1} className={cls} onClick={() => close(false)}>
                {body}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={disabled || undefined}
                className={cls}
                onClick={() => {
                  if (disabled) return;
                  close(false);
                  item.onSelect?.();
                }}
              >
                {body}
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}
