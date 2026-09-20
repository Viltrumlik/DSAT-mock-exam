"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Button } from "./primitives";
import { CARD_SURFACE } from "./tones";

/**
 * A modal with one decision in it. Escape and the backdrop both close it, and neither confirms —
 * a destructive action is never one stray click away.
 */
export function Dialog({
  open, title, description, children, confirmLabel = "Confirm", cancelLabel = "Cancel",
  tone = "primary", busy = false, onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;
  return (
    <div
      role="presentation"
      onClick={() => { if (!busy) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 60, display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16,
        background: "rgba(15,23,41,.45)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ ...CARD_SURFACE, width: "100%", maxWidth: 440, padding: "26px 28px", boxShadow: "0 24px 60px rgba(15,23,41,.18)" }}
      >
        <h2 style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.01em", color: "var(--dz-ink)", margin: 0 }}>{title}</h2>
        {description && <p style={{ fontSize: 14, color: "var(--dz-mute)", marginTop: 8 }}>{description}</p>}
        {children && <div style={{ marginTop: 16 }}>{children}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          {onConfirm && (
            <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} busy={busy}>
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
