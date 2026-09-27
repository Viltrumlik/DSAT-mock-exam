"use client";

import type { ReactNode } from "react";

/**
 * Every teacher page's frame. It is what puts a page INSIDE the `.dzboard` scope — the tokens
 * and the Plus Jakarta face the whole kit styles itself from — so a page that forgets to wear
 * it renders in the old look and the mistake is visible immediately.
 *
 * `dz-content` is the scope's own section-in animation, shared with the student dashboard.
 */
export function TeacherPage({ title, subtitle, actions, children }: {
  title: string; subtitle?: string; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="dzboard" style={{ maxWidth: 1280, width: "100%", margin: "0 auto", padding: "22px 16px 48px" }}>
      <div className="dz-content">
        <header style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
          {/* A basis rather than `flex: 1`, so on a phone the actions wrap to their own line
              instead of squeezing the title's date onto two. */}
          <div style={{ minWidth: 0, flex: "1 1 220px" }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.02em", color: "var(--dz-ink)", margin: 0 }}>
              {title}
            </h1>
            {subtitle && <p style={{ fontSize: 14, color: "var(--dz-mute)", fontWeight: 500, marginTop: 6 }}>{subtitle}</p>}
          </div>
          {actions}
        </header>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>{children}</div>
      </div>
    </div>
  );
}
