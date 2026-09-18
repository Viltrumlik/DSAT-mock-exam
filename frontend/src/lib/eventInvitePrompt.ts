/**
 * Remembers which event invitations a student has been shown, so the sign-in prompt
 * interrupts once and then leaves them alone.
 *
 * `sessionStorage`, deliberately, for the same reason the survey prompt uses it: a
 * `localStorage` dismissal would silence an event for good on that browser, and the seat is
 * still there tomorrow. Keyed per event id, never one flag — this week's open day must not
 * swallow next month's.
 *
 * Lives in `lib/` rather than the feature because `lib/api.ts` has to reach it from
 * `authApi.logout` without importing a feature: signing out and back in inside ONE tab keeps
 * the session alive, so without that call the marker would survive a real sign-in.
 */

const PREFIX = "mastersat.event-invite.";

export function wasEventInviteShown(eventId: number): boolean {
  try {
    return window.sessionStorage.getItem(PREFIX + eventId) === "1";
  } catch {
    // Storage blocked (private mode, blocked cookies). "Not yet shown" is the safe
    // direction: the prompt appears, and it can always be closed.
    return false;
  }
}

export function markEventInviteShown(eventId: number): void {
  try {
    window.sessionStorage.setItem(PREFIX + eventId, "1");
  } catch {
    /* ignore — see above */
  }
}

export function clearEventInvitePrompts(): void {
  try {
    const store = window.sessionStorage;
    // Collected before removing: `key(i)` walks a live index, so deleting inside the loop
    // shuffles the rest down and skips every other one.
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(PREFIX)) doomed.push(key);
    }
    doomed.forEach((key) => store.removeItem(key));
  } catch {
    /* ignore — see above */
  }
}
