"use client";

import { useCallback, useEffect, useState } from "react";

/** Per user, the Tashkent date ("2026-10-31") a student said "Not today" on. */
const SKIP_KEY_PREFIX = "mastersat.qotd-skipped.";

/**
 * "Not today" on the Question of the Day prompt, remembered for that day only.
 *
 * Keyed by the server's date for the card, not the browser's clock, so the prompt comes back
 * exactly when the server deals the next day's questions. Kept on this device: a skip is a
 * "not now", not a forfeit — the question stays answerable until midnight, and a student who
 * opens the site on another device is asked again.
 */
export function useQotdSkip(userId: number | null | undefined, date: string | undefined) {
  const key = userId ? `${SKIP_KEY_PREFIX}${userId}` : null;
  const [skippedOn, setSkippedOn] = useState<string | null | undefined>(undefined);

  // Read after mount, never during render (no localStorage on the server). Until it is read
  // the prompt stays hidden: a flash of a prompt already skipped is worse than a late one.
  useEffect(() => {
    if (!key) return;
    try {
      setSkippedOn(window.localStorage.getItem(key));
    } catch {
      setSkippedOn(null);
    }
  }, [key]);

  const skip = useCallback(() => {
    if (!date) return;
    setSkippedOn(date);
    if (!key) return;
    try {
      window.localStorage.setItem(key, date);
    } catch {
      // Storage refused (private mode): the skip still holds until the page reloads.
    }
  }, [key, date]);

  return {
    ready: skippedOn !== undefined,
    skipped: Boolean(date) && skippedOn === date,
    skip,
  };
}
