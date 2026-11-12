"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { buttonClass } from "@/features/console/ui";

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
    <div className="animate-ms-scrim-in fixed inset-0 z-[60] flex items-center justify-center bg-ms-scrim p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="animate-ms-dialog-in w-full max-w-md space-y-4 rounded-ms-dlg border border-ms-border bg-ms-card p-[22px] shadow-ms-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">
          {title}
        </h2>
        <div id={bodyId} className="space-y-3 text-[15px] leading-[23px] text-ms-fg-2">
          {body}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          {cancelLabel === null ? null : (
            <button
              ref={firstRef}
              type="button"
              onClick={onCancel}
              className={buttonClass()}
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={cancelLabel === null ? firstRef : undefined}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={buttonClass({ variant: danger ? "danger" : "primary" })}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
