/**
 * Keep the display awake while a midterm is open in the app (2026-10-11, the school's request).
 * Ported from the site's hooks/useScreenWakeLock.ts with the same contract — keep the two in step.
 *
 * WHY: a student reading or working on paper does not touch the keyboard, and after the OS's
 * inactivity timeout the display sleeps and usually locks. To the WebView that is the page going
 * hidden and losing focus, which the off-screen guard (./useOffscreenGuard.ts) reports as leaving
 * the paper; the server allows GRACE_SECONDS = 3 and VIOLATION_LIMIT = 3
 * (backend/midterms/proctoring.py), so a quiet stretch spends a strike and three forfeit a paper
 * the student never left. This is the browser's "a video is playing" signal (the Screen Wake Lock
 * API, what YouTube holds during playback).
 *
 * The native side already does the same while the machine is LOCKED DOWN —
 * desktop/src-tauri/src/lockdown.rs engage() sets ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED and
 * release() clears it. That covers the running paper only; the rules, access-code and pre-check
 * screens come before the lock, and a student reading the rules can sit there long enough for the
 * display to sleep. This hook covers the whole sitting, and is harmless overlap while locked.
 *
 * Contract (best-effort; a lock is a convenience, never a precondition):
 *   - feature-detected with `in` (lib.dom types `navigator.wakeLock` as always present);
 *   - requested only while the page is visible; every rejection (NotAllowedError when hidden, in
 *     power-saving mode or under a policy) is swallowed — nothing here may throw into the exam;
 *   - the WebView releases the lock whenever the page is hidden, so the sentinel's "release"
 *     event drops our reference and the next visibilitychange → visible asks again while active;
 *   - a request still in flight when the hook deactivates or unmounts releases its sentinel the
 *     moment it resolves. No hidden-video ("NoSleep") fallback.
 *
 * Importer: exam/midterm/MidtermScreen.tsx.
 */
import { useEffect } from "react";

/**
 * Let a sentinel go without anything reaching the exam. `release()` returns a promise, but the
 * effect cleanup that calls it runs inside React's commit, so an embedder that throws
 * synchronously instead would take the runner down with it — both shapes are swallowed.
 */
function releaseQuietly(sentinel: WakeLockSentinel): void {
  try {
    void sentinel.release().catch(() => {});
  } catch {
    // Best-effort, like everything here: the lock is a convenience.
  }
}

export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || typeof document === "undefined") return;
    if (!("wakeLock" in navigator) || !navigator.wakeLock) return;
    const wakeLock = navigator.wakeLock;

    let disposed = false;
    let held: WakeLockSentinel | null = null;
    let pending = false;
    // The page came back while a request was in flight; it may resolve to a sentinel the WebView
    // already released, so ask once more when it settles.
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
        pending = false;
        return;
      }
      promise.then(
        (sentinel) => {
          if (disposed) {
            // Deactivated or unmounted while asking — never keep a lock nobody owns.
            releaseQuietly(sentinel);
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
      if (sentinel && !sentinel.released) releaseQuietly(sentinel);
    };
  }, [active]);
}
