/**
 * One fact shared between the runner's fullscreen control and the off-screen rule:
 * "the transition you are about to see is one WE asked for".
 *
 * The Fullscreen API reports a programmatic enter/exit with exactly the same event a
 * student pressing Esc produces, and an off-screen offence costs a third of a midterm
 * allowance — so the runner must never bill a student for its own Start gesture or for
 * the "return to fullscreen" button.
 *
 * Module scope rather than a ref because the marker is set in one hook (useFullscreen)
 * and read in another (useOffscreenGuard), and it has to outlive either re-rendering.
 *
 * It is a WINDOW, not a pardon: the mark only covers the time the transition needs to
 * settle. A student who is still outside fullscreen after that has left the exam, and
 * the guard charges them — otherwise the header's fullscreen toggle would be a way to
 * sit next to your notes for free.
 */

/** How long a self-requested transition may take before it counts as the student leaving. */
export const SELF_FULLSCREEN_SETTLE_MS = 1200;

let settleUntil = 0;

export function markSelfFullscreenTransition(ms: number = SELF_FULLSCREEN_SETTLE_MS): void {
  // Never shorten a mark already in flight — two requests can overlap (Start, then a
  // retry), and the later one must not expose the earlier one's transition.
  settleUntil = Math.max(settleUntil, Date.now() + ms);
}

/** Milliseconds left of the settle window; 0 when nothing self-requested is in flight. */
export function selfFullscreenSettling(): number {
  return Math.max(0, settleUntil - Date.now());
}

/** Forget any pending mark (tests, and the runner tearing down between sittings). */
export function resetSelfFullscreenTransition(): void {
  settleUntil = 0;
}
