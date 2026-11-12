"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * Choice (design handoff v0.3, Controls board): radio with a line about each choice, a switch that
 * "takes effect at once" (so it never sits in a form with a Save button), and the segmented control with
 * the chosen one raised on a thumb that slides. A disabled choice says why.
 */

// ─── Radio ───────────────────────────────────────────────────────────────────

export type RadioOption<T extends string> = { value: T; label: ReactNode; description?: ReactNode; disabledReason?: string };

export function RadioGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  className,
}: {
  legend: ReactNode;
  options: RadioOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-1", className)}>
      <legend className="mb-1.5 text-[14px] font-medium leading-5 text-ms-fg">{legend}</legend>
      {options.map((o) => {
        const disabled = Boolean(o.disabledReason);
        const on = value === o.value;
        return (
          <label key={o.value} className={cn("flex min-h-10 items-start gap-3 rounded-[10px] py-1.5", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
            <span className="relative mt-0.5 inline-grid size-5 shrink-0 place-items-center">
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={on}
                disabled={disabled}
                onChange={() => onChange(o.value)}
                className="peer absolute -inset-2.5 z-[1] m-0 cursor-[inherit] appearance-none rounded-full focus-visible:outline-none"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "ms-transition grid size-5 place-items-center rounded-full border-[1.5px]",
                  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ms-ring",
                  disabled ? "border-ms-border bg-ms-surface-2" : on ? "border-ms-primary bg-ms-primary" : "border-ms-border-input bg-ms-card",
                )}
              >
                {on ? <span className="animate-ms-check-pop size-2 rounded-full bg-white" /> : null}
              </span>
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={cn("text-[15px] leading-5", disabled ? "text-ms-fg-disabled" : "text-ms-fg")}>{o.label}</span>
              {o.disabledReason || o.description ? (
                <span className="text-[13px] leading-[18px] text-ms-fg-3">{o.disabledReason ?? o.description}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

// ─── Switch ──────────────────────────────────────────────────────────────────

export function Switch({
  checked,
  onChange,
  label,
  help,
  disabledReason,
  busy = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  /** What switching does, at once: "Sends on the 5th to everyone who owes." */
  help?: ReactNode;
  /** Off-limits, in words: "Super admin only". */
  disabledReason?: string;
  /** While the change is being saved. */
  busy?: boolean;
}) {
  const id = useId();
  const disabled = Boolean(disabledReason) || busy;
  return (
    <div className="flex min-h-10 items-start justify-between gap-4 py-1">
      <span className="flex min-w-0 flex-col">
        <label htmlFor={id} className={cn("text-[15px] leading-5", disabledReason ? "text-ms-fg-disabled" : "text-ms-fg")}>{label}</label>
        {disabledReason || help ? <span id={`${id}-d`} className="text-[13px] leading-[18px] text-ms-fg-3">{disabledReason ?? help}</span> : null}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={disabledReason || help ? `${id}-d` : undefined}
        aria-busy={busy || undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-10 shrink-0 rounded-full border transition-colors duration-200 ease-out",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ms-ring disabled:cursor-not-allowed",
          checked ? "border-ms-primary bg-ms-primary" : "border-ms-border-strong bg-ms-surface-3",
          disabledReason && "opacity-60",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0.5 top-0.5 grid size-[18px] place-items-center rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,.3)] transition-[translate] duration-200 ease-out motion-reduce:transition-none",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        >
          {busy ? <Icon name="loader" size="sm" className="animate-ms-spin size-3 text-ms-fg-3" /> : null}
        </span>
      </button>
    </div>
  );
}

// ─── Segmented ───────────────────────────────────────────────────────────────

export type SegmentOption<T extends string> = { value: T; label: ReactNode; icon?: IconName };

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  /** The group's name for a screen reader: "Theme". */
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const at = Math.max(0, options.findIndex((o) => o.value === value));

  useLayoutEffect(() => {
    const el = wrap.current?.querySelectorAll<HTMLElement>('[role="radio"]')[at];
    if (el && el.offsetWidth) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [at, options.length]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? options.length - 1 : (at + step + options.length) % options.length;
    onChange(options[next].value);
    wrap.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div ref={wrap} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn("relative inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-ms-surface-2 p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      {thumb ? (
        <span
          aria-hidden="true"
          className="absolute top-[3px] bottom-[3px] rounded-full bg-ms-card shadow-ms-1 transition-[left,width] duration-200 ease-out motion-reduce:transition-none"
          style={{ left: thumb.left, width: thumb.width }}
        />
      ) : null}
      {options.map((o, i) => {
        const on = i === at;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-[1] inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[14px] leading-none transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ms-ring",
              size === "sm" ? "h-7" : "h-[calc(var(--ms-h-ctl)-8px)]",
              on ? "font-semibold text-ms-fg" : "font-medium text-ms-fg-2 hover:text-ms-fg",
              !thumb && on && "bg-ms-card shadow-ms-1",
            )}
          >
            {o.icon ? <Icon name={o.icon} size="sm" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
