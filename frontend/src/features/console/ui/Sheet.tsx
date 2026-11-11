"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { usePresence } from "./presence";

/**
 * A side sheet (design handoff v0.3, Overlays board, "Do the task, keep the list"): 480 px (640 for
 * a wide form) from the right, the page dimmed but in place behind it. It slides in and back out,
 * Esc and the scrim close it, and focus starts on its close button and returns where it was.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** The sheet's actions; by default only "Esc to close". */
  footer?: ReactNode;
  wide?: boolean;
  /** Hide it from some width up, e.g. "min-[1600px]:hidden" where a column shows the same thing. */
  className?: string;
}) {
  const { mounted, closing } = usePresence(open);
  const id = useId();
  const close = useRef<HTMLButtonElement | null>(null);
  // The parent passes a new function each render; the effect must not re-run (and refocus) for that.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      back?.focus?.();
    };
  }, [open]);

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div className={cn("ms fixed inset-0 z-[60] bg-transparent", className)} data-state={closing ? "closing" : "open"}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        onClick={onClose}
        className={cn("absolute inset-0 bg-ms-scrim", closing ? "animate-ms-scrim-out" : "animate-ms-scrim-in")}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full flex-col border-l border-ms-border bg-ms-card shadow-ms-3",
          wide ? "max-w-[min(640px,92vw)]" : "max-w-[min(480px,88vw)]",
          closing ? "animate-ms-sheet-out-right" : "animate-ms-sheet-in-right",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-ms-border px-5 py-3.5">
          <h2 id={id} className="text-[18px] font-bold text-ms-fg">
            {title}
          </h2>
          <Button ref={close} variant="ghost" size="sm" icon="x" aria-label="Close" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-ms-border bg-ms-surface px-5 py-3">
          {footer ?? <span className="mr-auto text-[13px] text-ms-fg-3">Esc to close</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
