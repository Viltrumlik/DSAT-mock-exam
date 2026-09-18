"use client";

/**
 * The interruptions a student may meet on the first page after signing in — one at a time.
 *
 * Three dialogs now want that moment: the notification opt-in, the survey invitation, and the
 * event invitation. All three portal to `z-[200]`, so left to themselves they would paint
 * scrims on top of each other, and a student would dismiss the top one only to find another
 * underneath. This component exists to make that impossible by construction rather than by
 * tuning delays until they miss each other — see the priority chain below.
 *
 * Sharing ONE `usePushOptIn` between the decision and the dialog is the load-bearing part.
 * The hook reads its dismissal from `localStorage` at mount and never re-reads it, so a second
 * instance would never learn that the first had been dismissed — the survey prompt would then
 * be blocked behind a dialog that had already closed, until the next full page load.
 */

import { EventInviteDialog } from "@/features/events/EventInviteDialog";
import { PushOptInDialog } from "@/features/notifications/PushOptInDialog";
import { usePushOptIn } from "@/features/notifications/usePushOptIn";
import { SurveyInviteDialog } from "@/features/surveys/SurveyInviteDialog";

export function StudentPrompts() {
  const optIn = usePushOptIn();

  // A priority chain, and only ONE of these is ever mounted: each dialog starts its own
  // open-timer at mount, which is what keeps two of them from painting scrims on the same
  // screen. Push first, because a refusal is permanent per origin and there is no second
  // ask. Then the survey, which the learning center is chasing replies to. The event last:
  // it is the one whose own surfaces (the top-bar button, the dashboard card) carry it
  // anyway, so it loses the least by waiting for the next sign-in.
  if (optIn.shouldAsk) return <PushOptInDialog optIn={optIn} />;
  return (
    <>
      <SurveyInviteDialog />
      <EventInviteDialog />
    </>
  );
}
