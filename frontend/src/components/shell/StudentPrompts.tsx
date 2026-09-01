"use client";

/**
 * The interruptions a student may meet on the first page after signing in — one at a time.
 *
 * Two dialogs now want that moment: the notification opt-in and the survey invitation. Both
 * portal to `z-[200]`, so left to themselves they would paint two scrims on the same screen,
 * and a student would dismiss the top one only to find another underneath. This component
 * exists to make that impossible by construction rather than by tuning delays until they miss
 * each other.
 *
 * **The notification ask goes first**, and the ordering is not arbitrary: a push refusal is
 * permanent per origin — there is no second prompt and no API to reset one — and the ask only
 * ever happens once per browser. The survey invitation costs nothing to postpone, because it
 * comes back at the next sign-in while the survey is still open. So the one that cannot be
 * repeated takes the slot, and the one that can, waits.
 *
 * Sharing ONE `usePushOptIn` between the decision and the dialog is the load-bearing part.
 * The hook reads its dismissal from `localStorage` at mount and never re-reads it, so a second
 * instance would never learn that the first had been dismissed — the survey prompt would then
 * be blocked behind a dialog that had already closed, until the next full page load.
 */

import { PushOptInDialog } from "@/features/notifications/PushOptInDialog";
import { usePushOptIn } from "@/features/notifications/usePushOptIn";
import { SurveyInviteDialog } from "@/features/surveys/SurveyInviteDialog";

export function StudentPrompts() {
  const optIn = usePushOptIn();

  // Not rendered side by side with a `hidden` flag: the survey dialog only starts its own
  // timer once it is mounted, which is what makes the two land back to back with a visible
  // gap rather than the survey prompt appearing the instant push is dismissed.
  if (optIn.shouldAsk) return <PushOptInDialog optIn={optIn} />;
  return <SurveyInviteDialog />;
}
