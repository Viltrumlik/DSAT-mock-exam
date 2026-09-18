"use client";

/**
 * The interruptions a student may meet on the first page after signing in — one at a time.
 *
 * Three dialogs now want that moment: the notification opt-in, the survey invitation, and the
 * event invitation. All three portal to `z-[200]`, so left to themselves they would paint
 * scrims on top of each other, and a student would dismiss the top one only to find another
 * underneath.
 *
 * Push is kept exclusive by construction, right here: `if (optIn.shouldAsk) return
 * <PushOptInDialog .../>` means neither the survey nor the event dialog is even mounted while
 * a push decision is still pending. Survey and Event, below, are NOT gated the same way — they
 * are mounted as siblings, because a student can be owed both in the same sign-in, and gating
 * the event invitation on "no surveys waiting" would silence it for the whole two weeks a
 * survey stays open. Their exclusivity is `EventInviteDialog`'s own job: it waits out a longer
 * delay than the survey's, then checks the DOM for any other open dialog and keeps re-checking
 * until the screen is clear. See its header comment for the mechanics.
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

  // Push is exclusive by construction: while a push decision is pending, this return means
  // neither the survey nor the event dialog below is even mounted. Once push is out of the
  // way, the survey and the event dialog ARE mounted together — see the header comment for
  // why, and for how EventInviteDialog itself keeps the two from opening on top of each other.
  if (optIn.shouldAsk) return <PushOptInDialog optIn={optIn} />;
  return (
    <>
      <SurveyInviteDialog />
      <EventInviteDialog />
    </>
  );
}
