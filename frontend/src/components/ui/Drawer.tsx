"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useOverlayFaceClass } from "./OverlayFace";

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  side?: "right" | "left";
  width?: number;
};

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  side = "right",
  width = 420,
}: DrawerProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Portalled onto <body>, out of the page's typeface — see OverlayFace.
  const faceClass = useOverlayFaceClass();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className={cn("fixed inset-0 z-[200]", faceClass)}>
      <div
        className="ds-anim-fade absolute inset-0 bg-[var(--overlay-scrim)]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{ width: `min(100%, ${width}px)` }}
        className={cn(
          // It had four square corners and was welded to the edge of the screen. On anything
          // wider than a phone it now floats clear of all four edges and is rounded like every
          // other surface in the product; on a phone it stays flush, where a floating sheet
          // would only spend the width the content needs — but the two corners facing the page
          // are rounded there too, because those are the ones a reader actually sees.
          "absolute inset-y-0 flex flex-col overflow-hidden border-border bg-card shadow-modal",
          "sm:inset-y-3 sm:rounded-3xl sm:border",
          side === "right"
            ? "right-0 rounded-l-3xl border-l ds-anim-slide-right sm:right-3"
            : "left-0 rounded-r-3xl border-r sm:left-3",
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          {title ? <h2 className="ds-h3 truncate">{title}</h2> : <span />}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ds-ring -m-1.5 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-3 border-t border-border bg-surface-1 px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
