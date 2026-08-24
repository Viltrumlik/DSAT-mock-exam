"use client";

/**
 * The notification ask, as a dialog a student cannot miss.
 *
 * It was a banner in the shell before this, and the banner was already the second attempt —
 * the first lived inside the bell drawer, where only a student who opened the bell ever met
 * it. The school's report on the banner was the same as on the drawer: students are not
 * seeing it. Production agrees, and precisely: **12 push subscriptions across the whole
 * school.** A card in the page flow is furniture, and students scroll past furniture.
 *
 * So this is a modal. It interrupts once, on the first page after signing in, and then never
 * again unless the student clears their storage — the same `usePushOptIn` rules decide *when*
 * it is allowed to appear at all, and those rules are the important part:
 *
 *   * **Browsers ignore `requestPermission` outside a user gesture.** The ask cannot be
 *     "automatic" no matter how the dialog is styled. What is automatic is the DIALOG; the
 *     permission prompt itself fires on the student's click, which is the gesture.
 *   * **A refusal is permanent per origin.** There is no second chance and no API to undo it.
 *     That is the whole reason this is worth interrupting for once and then not nagging: a
 *     student who dismisses a card ten times and finally clicks "no" out of irritation has
 *     cost themselves push notifications on that browser for good.
 *
 * A short delay before it opens is deliberate. Appearing in the same frame as the dashboard
 * reads as a page error, and a dialog that lands while the layout is still settling gets
 * dismissed reflexively — which, per the point above, is expensive.
 */

import { useEffect, useState } from "react";
import { BellRing, Check } from "lucide-react";

import { Modal } from "@/components/ui";

import { usePushOptIn } from "./usePushOptIn";

/** Long enough that the page has settled, short enough to still read as "on login". */
const OPEN_DELAY_MS = 1500;

export function PushOptInDialog() {
  const { shouldAsk, state, ask, dismiss } = usePushOptIn();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!shouldAsk) {
      setOpen(false);
      return;
    }
    const timer = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [shouldAsk]);

  if (!shouldAsk) return null;

  // Closing by any route — the X, the backdrop, Escape — counts as "not now" and is
  // remembered. A dialog that returns on the next client-side navigation is how a one-time
  // ask turns into nagging, which is what produces the reflexive refusal this whole flow is
  // built to avoid.
  const close = () => {
    setOpen(false);
    dismiss();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Turn on notifications"
      description="So you hear about your work when it happens, not when you next open the site."
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <BellRing className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <ul className="space-y-1.5">
            {[
              "New homework, the moment it's set",
              "Your score, as soon as it's marked",
              "Support sessions, when they're confirmed",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2 text-sm font-semibold text-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs font-medium text-muted-foreground">
            Works on this computer and on your phone. You can turn it off again at any time
            from your profile.
          </p>
        </div>
      </div>

      {state === "refused" ? (
        // The browser said no, and nothing here can reopen that door. Say where the switch
        // actually is instead of offering a button that will silently do nothing.
        <p className="mt-4 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-xs font-semibold text-muted-foreground">
          Your browser blocked notifications for this site. To allow them, open the padlock
          next to the address bar and set Notifications to Allow.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={close}
          className="ds-ring rounded-xl px-4 py-2 text-sm font-extrabold text-muted-foreground"
        >
          Not now
        </button>
        {state !== "refused" ? (
          <button
            type="button"
            // MUST stay a direct click handler. Anything that defers the call — a promise
            // chain before `requestPermission`, a setTimeout — loses the user gesture and the
            // browser drops the prompt with no error at all.
            onClick={() => {
              void ask().finally(() => setOpen(false));
            }}
            disabled={state === "asking"}
            className="ds-ring rounded-xl bg-primary px-4 py-2 text-sm font-extrabold text-primary-foreground disabled:opacity-60"
          >
            {state === "asking" ? "Waiting…" : "Turn on notifications"}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

export default PushOptInDialog;
