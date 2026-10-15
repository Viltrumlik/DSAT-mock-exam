"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A plain yes/no step before an action that cannot be taken back from this page — the same overlay
 * as ConfirmBulkModal, without its type-DELETE gate. Escape and the backdrop cancel; Cancel takes the
 * focus first, so a stray Enter does not confirm. With `cancelLabel={null}` it is a notice with one
 * button (the one-time password's "tell them this").
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
  cancelLabel = "Cancel",
  danger = false,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Null hides the second button. */
  cancelLabel?: string | null;
  /** The confirm button in red: it destroys something. */
  danger?: boolean;
}) {
  const titleId = useId();
  const bodyId = useId();
  const firstRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay-scrim)] p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold text-foreground">
          {title}
        </h2>
        <div id={bodyId} className="space-y-3 text-sm text-muted-foreground">
          {body}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          {cancelLabel === null ? null : (
            <button
              ref={firstRef}
              type="button"
              onClick={onCancel}
              className="h-9 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={cancelLabel === null ? firstRef : undefined}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "h-9 rounded-lg px-4 text-sm font-semibold hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50",
              danger
                ? "bg-danger text-white focus-visible:ring-danger"
                : "bg-primary text-primary-foreground focus-visible:ring-primary",
            )}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
