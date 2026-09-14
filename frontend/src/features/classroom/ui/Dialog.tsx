"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useOverlayFaceClass } from "@/components/ui/OverlayFace";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" } as const;

/** Accessible modal: Escape to close, scrim click to close, body scroll lock. */
export function Dialog({ open, onClose, title, description, size = "md", children, footer }: DialogProps) {
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

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn("fixed inset-0 z-50 flex items-end justify-center sm:items-center", faceClass)}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-[var(--overlay-scrim)] backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        className={cn(
          "relative z-10 w-full rounded-t-2xl border border-border bg-card shadow-[var(--ds-shadow-lg)] sm:rounded-2xl",
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 p-5 sm:p-6 pb-0">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-foreground">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 sm:p-6">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border p-4 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
