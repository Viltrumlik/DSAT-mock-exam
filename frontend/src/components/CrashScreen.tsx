"use client";

import { useEffect } from "react";
import { isStaleBuildError, reloadOnceForStaleBuild } from "@/lib/staleBuild";
import { reportClientError } from "@/lib/clientErrorReport";

/**
 * What a student sees instead of Next.js's bare "Application error: a client-side exception has
 * occurred" — a sentence they can act on and a button that does it.
 *
 * Inline styles only: `global-error.tsx` renders it in place of the root layout, where the
 * stylesheet and the theme provider may be the very thing that failed to load.
 */
export function CrashScreen({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  const stale = isStaleBuildError(error);

  useEffect(() => {
    console.error(error);
    reportClientError(error, stale ? "stale" : "crash");
    if (stale) reloadOnceForStaleBuild();
  }, [error, stale]);

  return (
    <div
      role="alert"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        textAlign: "center",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        background: "#eef2fa",
        color: "#0f172a",
      }}
    >
      <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
        {stale ? "MasterSAT has been updated" : "Something went wrong"}
      </p>
      <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0, maxWidth: 360, color: "#475569" }}>
        {stale
          ? "This page was opened before the update. Reload it to get the new version."
          : "The page could not be shown. Reloading usually fixes it."}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          border: 0,
          borderRadius: 10,
          padding: "12px 24px",
          fontSize: 15,
          fontWeight: 600,
          background: "#1828b1",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Reload
      </button>
      {reset && !stale ? (
        <button
          type="button"
          onClick={reset}
          style={{ border: 0, background: "none", fontSize: 14, color: "#475569", cursor: "pointer" }}
        >
          Try again without reloading
        </button>
      ) : null}
    </div>
  );
}
