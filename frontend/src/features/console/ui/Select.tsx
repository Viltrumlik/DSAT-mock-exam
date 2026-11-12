"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { inputShell, useFieldControl } from "./Field";
import { usePresence } from "./presence";

/**
 * Select (design handoff v0.3, Controls board): a button that opens a listbox under it. ↑ ↓ Home End move,
 * typing a letter jumps to the next option starting with it, Enter / Space pick, Esc or a click outside
 * closes and gives focus back. The chosen option is bold with a check. A disabled option says why.
 */
export type ListOption<T extends string = string> = {
  value: T;
  label: string;
  /** A second line: "Tue Thu Sat 16:00 · 14 seats". */
  sub?: string;
  /** Right of the label: "14 seats", "Run by lc-up". */
  meta?: string;
  /** The option can't be picked; the words say why ("Add seats in lc-up — this class is synced"). */
  disabledReason?: string;
};

/** One row of a listbox (Select and Combobox draw options the same way). */
export function OptionRow({
  id,
  index,
  option,
  active,
  selected,
  onPick,
  onHover,
  label,
}: {
  id: string;
  index: number;
  option: ListOption;
  active: boolean;
  selected: boolean;
  onPick: () => void;
  onHover: () => void;
  /** The label as drawn (Combobox bolds what was typed). */
  label?: ReactNode;
}) {
  const disabled = Boolean(option.disabledReason);
  return (
    <div
      id={id}
      data-i={index}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={onHover}
      onClick={() => !disabled && onPick()}
      className={cn(
        "flex min-h-10 items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-[15px] leading-5",
        disabled ? "cursor-not-allowed text-ms-fg-disabled" : "cursor-pointer text-ms-fg",
        active && !disabled && "bg-ms-surface-2",
        selected && "font-semibold",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label ?? option.label}</span>
        {option.disabledReason || option.sub ? (
          <span className="truncate text-[13px] font-normal leading-[18px] text-ms-fg-3">{option.disabledReason ?? option.sub}</span>
        ) : null}
      </span>
      {option.meta ? <span className="shrink-0 text-[13px] font-normal text-ms-fg-3">{option.meta}</span> : null}
      {selected ? <Icon name="check" size="sm" className="shrink-0 text-ms-primary-text" /> : <span className="w-4 shrink-0" />}
    </div>
  );
}

export const LISTBOX = "absolute left-0 top-full z-50 mt-1.5 max-h-[320px] w-full min-w-[220px] overflow-y-auto rounded-ms-pop border border-ms-border bg-ms-card p-1.5 shadow-ms-2 outline-none";

/** The next enabled index from `from` going `step`, wrapping; -1 when none. */
export function nextEnabled(options: readonly ListOption[], from: number, step: 1 | -1): number {
  const n = options.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + step * k) % n) + n) % n;
    if (!options[i].disabledReason) return i;
  }
  return -1;
}

/** Type-ahead: the next enabled option after `from` whose label starts with `prefix` (case and accents aside). */
export function typeAhead(options: readonly ListOption[], from: number, prefix: string): number {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const p = norm(prefix);
  const n = options.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n;
    if (!options[i].disabledReason && norm(options[i].label).startsWith(p)) return i;
  }
  return -1;
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  disabled = false,
  "aria-label": ariaLabel,
  className,
}: {
  value: T | null;
  onChange: (v: T) => void;
  options: ListOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  /** Needed outside a Field (inside one, its label names the select). */
  "aria-label"?: string;
  className?: string;
}) {
  const f = useFieldControl();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const { mounted, closing } = usePresence(open, 120);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const [active, setActive] = useState(selectedIndex);
  const button = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const typed = useRef({ text: "", at: 0 });

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const openAt = (i: number) => {
    setActive(i >= 0 && !options[i]?.disabledReason ? i : nextEnabled(options, -1, 1));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const pick = (i: number) => {
    const o = options[i];
    if (!o || o.disabledReason) return;
    onChange(o.value);
    close();
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openAt(e.key === "ArrowUp" && selectedIndex < 0 ? nextEnabled(options, options.length, -1) : selectedIndex);
    }
  };
  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => nextEnabled(options, a, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? nextEnabled(options, -1, 1) : nextEnabled(options, options.length, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      const more = now - typed.current.at < 700;
      typed.current = { text: more ? typed.current.text + e.key : e.key, at: now };
      // A run of letters keeps matching the current option; a fresh letter moves to the next match.
      const i = typeAhead(options, more ? active - 1 : active, typed.current.text);
      if (i >= 0) setActive(i);
    }
  };

  const chosen = options[selectedIndex];
  return (
    <span className={cn("relative inline-flex w-full min-w-0", className)}>
      <button
        ref={button}
        id={f.id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-describedby={f.describedBy}
        onClick={() => (open ? close() : openAt(selectedIndex))}
        onKeyDown={onButtonKey}
        className={cn(inputShell({ invalid: f.invalid, disabled }), "w-full text-left focus-visible:outline-none", open && !f.invalid && "border-ms-primary shadow-[0_0_0_3px_var(--ms-primary-soft-2)]")}
      >
        <span className={cn("min-w-0 flex-1 truncate", !chosen && "text-ms-fg-3")}>{chosen?.label ?? placeholder}</span>
        <Icon name="down" size="sm" className={cn("shrink-0 text-ms-fg-3 transition-[rotate] duration-150", open && "rotate-180")} />
      </button>
      {mounted ? (
        <div
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : f.id}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          onKeyDown={onListKey}
          className={cn(LISTBOX, "origin-top", closing ? "animate-ms-dialog-out" : "animate-ms-dialog-in")}
        >
          {options.map((o, i) => (
            <OptionRow key={o.value} id={`${listId}-${i}`} index={i} option={o} active={i === active} selected={i === selectedIndex} onPick={() => pick(i)} onHover={() => setActive(i)} />
          ))}
        </div>
      ) : null}
    </span>
  );
}
