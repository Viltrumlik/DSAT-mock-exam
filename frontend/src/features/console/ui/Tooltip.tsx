"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { usePresence } from "./presence";

/**
 * Names an icon button and shows its shortcut (design handoff v0.3, Overlays board: "Never the only
 * place for a reason, a status or a number"). Appears 400 ms after hover or keyboard focus, leaves
 * on blur, pointer-out or Esc. Silent to screen readers: the button's own name says it.
 */
export function Tooltip({
  label,
  shortcut,
  side = "top",
  children,
  className,
}: {
  label: string;
  shortcut?: string;
  side?: "top" | "bottom" | "right";
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const { mounted, closing } = usePresence(open, 120);
  const show = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 400);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  return (
    <span
      className={cn("relative inline-flex", className)}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape") hide();
      }}
    >
      {children}
      {mounted ? (
        <span
          aria-hidden="true"
          data-tooltip
          className={cn(
            "pointer-events-none absolute z-[90] flex items-center gap-2 whitespace-nowrap rounded-[8px] bg-ms-inverse-bg px-2.5 py-[7px] text-[13px] font-medium leading-[18px] text-ms-inverse-fg shadow-ms-2",
            side === "top" && "bottom-full left-1/2 mb-2 -translate-x-1/2",
            side === "bottom" && "left-1/2 top-full mt-2 -translate-x-1/2",
            side === "right" && "left-full top-1/2 ml-2 -translate-y-1/2",
            closing ? "animate-ms-fade-out" : "animate-ms-fade-in",
          )}
        >
          {label}
          {shortcut ? (
            <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-[rgba(127,127,127,.5)] px-1 font-ms-mono text-[12px]">
              {shortcut}
            </kbd>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
