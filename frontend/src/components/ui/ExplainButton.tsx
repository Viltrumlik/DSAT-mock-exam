"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";

type Side = "top" | "bottom" | "left" | "right";

const PANEL_SIDE: Record<Side, string> = {
  top: "bottom-full left-0 mb-2",
  bottom: "top-full left-0 mt-2",
  left: "right-full top-0 mr-2",
  right: "left-full top-0 ml-2",
};

/**
 * The small round **!** that explains the thing next to it.
 *
 * Asked for in as many words: *"! shunday beligi buttonlar qo'shing ularni bosganda
 * explanationlar chiqishi kerak"* — a button carrying an exclamation mark that, **when
 * pressed**, says what this place, function or button does.
 *
 * Pressed, not hovered. `Tooltip` is the kit's hover device and stays what it is: one
 * short line, on a pointer, for a label that did not fit. This is the other thing — a
 * paragraph a student opens deliberately, which has to work on a phone, where there is
 * no hover at all, and has to stay open while it is read.
 *
 * Deliberately not a modal: an explanation of one control should not black out the page
 * that control sits on. It closes on Escape, on a press anywhere outside it, and on its
 * own ✕.
 */
export function ExplainButton({
  title,
  children,
  side = "bottom",
  label,
  className,
  panelClassName,
}: {
  /** Heading inside the panel. Also the button's accessible name: "What is <title>?" */
  title: string;
  /** The explanation. Plain sentences beat a bulleted list at this size. */
  children: ReactNode;
  side?: Side;
  /** Override the accessible name when "What is <title>?" would read oddly. */
  label?: string;
  className?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    // `pointerdown`, not `click`: a click that lands on another ExplainButton would
    // otherwise close this one and immediately reopen the other in the same tick.
    function onOutside(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
    };
  }, [open, close]);

  return (
    <span ref={wrapRef} className={cn("relative inline-flex shrink-0 align-middle", className)}>
      <button
        type="button"
        aria-label={label ?? `What is ${title}?`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "ds-ring grid h-[19px] w-[19px] place-items-center rounded-full border text-[12px] font-black leading-none",
          "transition-[transform,background-color,color,border-color] duration-150",
          "hover:scale-110 active:scale-95",
          open
            ? "border-transparent bg-primary text-primary-foreground"
            : "border-primary/35 bg-primary/10 text-primary hover:bg-primary/20 dark:text-primary-hover",
        )}
      >
        <span aria-hidden>!</span>
      </button>

      {open ? (
        <span
          id={panelId}
          role="dialog"
          aria-label={title}
          className={cn(
            "ds-anim-pop absolute z-[320] w-[min(19rem,calc(100vw-2.5rem))] rounded-2xl border border-border bg-card p-3.5 text-left",
            "shadow-[var(--ds-shadow-lg)]",
            PANEL_SIDE[side],
            panelClassName,
          )}
        >
          <span className="flex items-start justify-between gap-2">
            <span className="text-[13px] font-extrabold leading-snug text-foreground">{title}</span>
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="ds-ring -mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
          <span className="mt-1.5 block text-[12.5px] font-medium leading-relaxed text-muted-foreground">
            {children}
          </span>
        </span>
      ) : null}
    </span>
  );
}
