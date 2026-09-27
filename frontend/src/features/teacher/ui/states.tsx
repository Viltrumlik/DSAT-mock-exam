"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./primitives";
import { TONE_INK, TONE_WASH } from "./tones";

/**
 * Nothing to show, and nothing went wrong. Quiet on purpose: no icon shouting, no colour.
 * It must never be mistaken for `ErrorState`, and `ErrorState` must never be mistaken for it —
 * a request that failed has repeatedly been drawn in this product as "there is nothing here",
 * which teaches the reader that their class is empty when in fact the server said no.
 */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div style={{ padding: "26px 4px", textAlign: "center" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--dz-ink)" }}>{title}</div>
      {hint && <div style={{ fontSize: 13, color: "var(--dz-mute)", marginTop: 6 }}>{hint}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

/**
 * A request did not come back. Says so, gives the server's reason when it gave one, and offers
 * the retry — inside the block that failed, so the rest of the page still renders.
 */
export function ErrorState({ title = "This didn't load", detail, onRetry, retryLabel = "Try again" }: {
  title?: string; detail?: string | null; onRetry?: () => void; retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      style={{
        display: "flex", gap: 12, alignItems: "flex-start",
        padding: "16px 18px", borderRadius: 16,
        background: TONE_WASH.danger, border: `1px solid ${TONE_INK.danger}33`,
      }}
    >
      <AlertTriangle size={18} style={{ color: TONE_INK.danger, flexShrink: 0, marginTop: 2 }} aria-hidden />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--dz-ink)" }}>{title}</div>
        {detail && <div style={{ fontSize: 13, color: "var(--dz-mute)", marginTop: 4 }}>{detail}</div>}
        {onRetry && (
          <div style={{ marginTop: 12 }}>
            <Button variant="ghost" onClick={onRetry}>
              <RotateCw size={14} aria-hidden />
              {retryLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
