/**
 * Tells the server about a crash a student just saw (`config/client_errors.py`), so a blank
 * screen on someone's phone leaves one line in the gunicorn log: the page, the error, the
 * browser and — when still signed in — who it was.
 *
 * Plain `fetch`, not the axios client: the crash may have taken the app's providers with it.
 * `keepalive` lets the report finish even when the stale-build path reloads the page right away.
 * Best-effort — a report that fails must never become a second error.
 */
export function reportClientError(error: Error & { digest?: string }, kind: "stale" | "crash"): void {
  try {
    void fetch("/api/health/client-error/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        kind,
        url: window.location.href.slice(0, 500),
        name: error?.name,
        message: String(error?.message ?? "").slice(0, 1000),
        digest: error?.digest,
        stack: String(error?.stack ?? "").slice(0, 4000),
      }),
    }).catch(() => undefined);
  } catch {
    /* nothing to do: the screen is already up */
  }
}
