"use client";
import { useEffect } from "react";

/**
 * Keep the display awake while a midterm is on screen (2026-10-11, the school's request).
 *
 * WHY: a student reading a long passage or working a problem on paper does not touch the
 * keyboard or mouse, and after the OS's inactivity timeout the display sleeps — on most
 * school machines it also LOCKS. To the browser that is the page going hidden and losing
 * focus, which is exactly what the off-screen guard (hooks/useOffscreenGuard.ts) counts as
 * leaving the paper. The server allows GRACE_SECONDS = 3 to come back and VIOLATION_LIMIT = 3
 * offences (backend/midterms/proctoring.py); a sleeping, locked screen blows through the
 * grace on its own, so one quiet minute spends a strike and three forfeit a paper the student
 * never left. The fix is not to loosen the rule but to stop the false leave: this is the
 * browser's "a video is playing" signal — the Screen Wake Lock API, the same thing YouTube
 * holds while a video plays — so the display stays on for as long as the paper is open.
 *
 * Contract (all of it best-effort; a lock is a convenience, never a precondition):
 *   - feature-detected: lib.dom types `navigator.wakeLock` as always present, but older
 *     Safari/Firefox and jsdom have none, so it is checked with `in` and the hook is a no-op;
 *   - requested only while the page is VISIBLE — the browser rejects a hidden request
 *     (NotAllowedError), as it does in power-saving mode or under a permissions policy; every
 *     rejection is swallowed, because nothing here may throw into, or block, the exam;
 *   - the browser releases the lock by itself whenever the page is hidden (alt-tab, a
 *     minimised window), so the sentinel's "release" event drops our reference and the next
 *     visibilitychange → visible asks again, for as long as `active` holds;
 *   - a request still in flight when the hook deactivates or unmounts releases its sentinel
 *     the moment it resolves, so a finished paper never leaves the screen pinned on.
 *
 * The Windows app holds the same lock natively while locked down (SetThreadExecutionState in
 * desktop/src-tauri/src/lockdown.rs) and carries a JS copy of this hook for the screens
 * before the lock engages: desktop/app/src/exam/lockdown/useScreenWakeLock.ts. No hidden-video
 * ("NoSleep") fallback — a looping muted video costs battery on every machine to cover a
 * shrinking set of browsers, and an invisible media element is one more thing to explain.
 *
 * Importer: pages/ExamRunnerPage.tsx (midterms only, until the paper is in).
 */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || typeof document === "undefined") return;
    if (!("wakeLock" in navigator) || !navigator.wakeLock) return;
    const wakeLock = navigator.wakeLock;

    let disposed = false;
    let held: WakeLockSentinel | null = null;
    let pending = false;
    // The page came back while a request was still in flight; that request may resolve to a
    // sentinel the browser already released, so ask once more when it settles.
    let retryWhenSettled = false;

    const settle = () => {
      pending = false;
      if (retryWhenSettled) {
        retryWhenSettled = false;
        request();
      }
    };

    function request() {
      if (disposed || held || document.visibilityState !== "visible") return;
      if (pending) {
        retryWhenSettled = true;
        return;
      }
      pending = true;
      let promise: Promise<WakeLockSentinel>;
      try {
        promise = wakeLock.request("screen");
      } catch {
        // A synchronous throw (an odd embedder) is the same answer as a rejection: no lock.
        pending = false;
        return;
      }
      promise.then(
        (sentinel) => {
          if (disposed) {
            // Deactivated or unmounted while asking — never keep a lock nobody owns.
            sentinel.release().catch(() => {});
            pending = false;
            return;
          }
          if (!sentinel.released) {
            held = sentinel;
            const onRelease = () => {
              sentinel.removeEventListener("release", onRelease);
              if (held === sentinel) held = null;
            };
            sentinel.addEventListener("release", onRelease);
          }
          settle();
        },
        () => {
          // NotAllowedError (hidden, power saving, policy) or anything else: best-effort.
          settle();
        },
      );
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") request();
    };

    request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const sentinel = held;
      held = null;
      if (sentinel && !sentinel.released) sentinel.release().catch(() => {});
    };
  }, [active]);
}
