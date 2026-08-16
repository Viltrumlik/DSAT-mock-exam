"use client";

import { useCallback, useEffect, useState } from "react";

import { permissionState, pushSupported, subscribeToPush } from "@/lib/push";

import { notificationsApi } from "./notificationsApi";
import { usePushConfig } from "./notificationsHooks";

/**
 * The one place that decides whether to ask a student for notification permission.
 *
 * Extracted because the ask now appears in two places — the bell drawer and a banner the
 * student meets right after signing in — and two copies of this logic would drift into
 * disagreeing about when it is safe to ask. It is not safe often:
 *
 *   * **Browsers ignore `requestPermission` outside a user gesture.** The school asked for the
 *     prompt to appear "on login". Firing it automatically after a redirect does nothing at
 *     all — no dialog, no error, `default` forever. So what happens on login is that a card
 *     appears; the actual ask happens on the student's click, which is the gesture.
 *   * **A refusal is permanent per origin.** There is no second chance and no API to reset it.
 *     Asking at a moment the student has no reason to say yes does not cost a prompt, it costs
 *     push notifications for that person on that browser for good.
 *   * **`enabled` comes from the server** and is false when VAPID keys are unset — which is the
 *     case in production today. Asking then would collect a permission nothing can use, and
 *     spend the one chance to get it.
 *
 * `dismissed` is persisted, unlike the drawer's original component state: the banner sits in
 * the shell and would otherwise return on every client-side navigation, which is nagging.
 */

const DISMISS_KEY = "mastersat.push-optin-dismissed";

export type PushOptInState = "idle" | "asking" | "done" | "refused";

export interface PushOptIn {
  /** Render the ask? False whenever asking would be wasted, unwanted, or impossible. */
  shouldAsk: boolean;
  state: PushOptInState;
  /** Must be called from a click handler — see the note above on user gestures. */
  ask: () => Promise<void>;
  dismiss: () => void;
}

export function usePushOptIn(): PushOptIn {
  const config = usePushConfig();
  const [state, setState] = useState<PushOptInState>("idle");
  const [dismissed, setDismissed] = useState(true);

  // Read after mount, never during render: `localStorage` does not exist while the server
  // renders, and seeding this from it directly would hydrate-mismatch. Starting at `true`
  // means the banner's default is "stay hidden" — a flash of a prompt the student already
  // dismissed is worse than showing it a beat late.
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // A browser refusing storage (private mode, blocked cookies) still gets the dismissal
      // for this session — it just cannot remember it. Not worth failing the interaction for.
    }
  }, []);

  const ask = useCallback(async () => {
    const publicKey = config.data?.public_key;
    if (!publicKey) return;
    setState("asking");
    const subscription = await subscribeToPush(publicKey);
    if (!subscription) {
      setState("refused");
      return;
    }
    try {
      await notificationsApi.subscribe(subscription);
      setState("done");
    } catch {
      // The browser granted permission and the server did not record it. Reporting "refused"
      // would be a lie about what the student did, but the retry has to remain available, so
      // the ask stays on screen in its idle shape.
      setState("idle");
    }
  }, [config.data?.public_key]);

  const supported = pushSupported();
  const shouldAsk =
    !dismissed &&
    supported &&
    Boolean(config.data?.enabled) &&
    permissionState() === "default" &&
    state !== "done";

  return { shouldAsk, state, ask, dismiss };
}
