"use client";

import { BellRing, X } from "lucide-react";

import { usePushOptIn } from "./usePushOptIn";

/**
 * The notification ask, where a student will actually meet it: in the shell, on the first
 * page after signing in.
 *
 * The same ask already existed inside the bell drawer, and that is why the school reported
 * that nothing ever asked them — a student who never opens the bell never sees it. Moving the
 * trigger out to the shell is the whole change; the timing rules live in `usePushOptIn`.
 *
 * It stays a card with a button rather than an automatic prompt because browsers ignore
 * `requestPermission` outside a user gesture. "Ask on login" is therefore implemented as
 * "offer on login, ask on click" — the closest thing to the request that actually works.
 */
export function PushOptInBanner() {
  const { shouldAsk, state, ask, dismiss } = usePushOptIn();

  if (!shouldAsk) return null;

  return (
    <div className="mx-auto mb-4 flex max-w-5xl items-start gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <BellRing className="h-4.5 w-4.5" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold text-foreground">Turn on notifications</p>
        <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
          {state === "refused"
            ? "Your browser blocked it. You can turn it back on in site settings."
            : "We'll tell you when homework is set, when it's marked, and when a support session is confirmed."}
        </p>

        {state !== "refused" ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void ask()}
              disabled={state === "asking"}
              className="ds-ring rounded-lg bg-primary px-3 py-1.5 text-xs font-extrabold text-primary-foreground disabled:opacity-60"
            >
              {state === "asking" ? "Waiting…" : "Turn on"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="ds-ring rounded-lg px-3 py-1.5 text-xs font-extrabold text-muted-foreground"
            >
              Not now
            </button>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="ds-ring -mr-1 -mt-1 rounded-lg p-1.5 text-muted-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export default PushOptInBanner;
