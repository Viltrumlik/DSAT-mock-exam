/**
 * Remembers which survey invitations a student has already been shown, so the sign-in prompt
 * interrupts once and then leaves them alone.
 *
 * **`sessionStorage`, deliberately, not `localStorage`.** The school asked for the prompt "when
 * a student logs in", and the two storages answer that differently: a `localStorage` dismissal
 * would silence the survey for good on that browser — for a survey the school is actively
 * chasing replies to, that is the wrong permanent decision to hand a student who clicked
 * "Later" once. `sessionStorage` forgets when the browser session ends, so the next sign-in
 * asks again while the survey is still open and still unanswered.
 *
 * That leaves one gap `sessionStorage` cannot see: signing out and back in inside the SAME tab
 * keeps the session alive, so the marker would survive a real login. `authApi.logout` closes it
 * by calling `clearSurveyInvitePrompts()` — which is why this lives in `lib/` beside the other
 * storage primitives (`lib/push.ts`) rather than inside the surveys feature: `lib/api.ts` has
 * to be able to reach it without importing a feature.
 *
 * Keyed per survey id, never a single flag: dismissing this term's feedback form must not
 * swallow the prompt for next week's.
 */

const PREFIX = "mastersat.survey-invite.";

/** Has this student already been shown the prompt for `surveyId` in this browser session? */
export function wasSurveyInviteShown(surveyId: number): boolean {
  try {
    return window.sessionStorage.getItem(PREFIX + surveyId) === "1";
  } catch {
    // Storage blocked (private mode, blocked cookies). Treating that as "not yet shown" is the
    // safe direction: the prompt appears, and the student can always close it.
    return false;
  }
}

/** Record that the prompt has been shown, whatever the student then did with it. */
export function markSurveyInviteShown(surveyId: number): void {
  try {
    window.sessionStorage.setItem(PREFIX + surveyId, "1");
  } catch {
    // A browser refusing storage still gets the dismissal for as long as the dialog is
    // mounted — it just cannot remember it across a reload. Not worth failing anything for.
  }
}

/** Forget every prompt, so the next sign-in starts clean. Called from `authApi.logout`. */
export function clearSurveyInvitePrompts(): void {
  try {
    const store = window.sessionStorage;
    // Collected before removing: `key(i)` walks a live index, so deleting inside the loop
    // shuffles the remaining keys down and skips every other one.
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
