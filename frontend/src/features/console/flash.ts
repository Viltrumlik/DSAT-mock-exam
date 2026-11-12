/**
 * "You are here" (design handoff v0.3, Motion board): after a jump, the row you land on glows once,
 * so the eye finds it. A list notes the row you open; when you come back to that list, that row
 * flashes. One mark at a time, kept for this tab only.
 */
const KEY = "ms-flash";

export function markReturn(scope: string, id: string | number): void {
  try {
    window.sessionStorage.setItem(KEY, `${scope}#${id}`);
  } catch {
    /* storage blocked: no flash, nothing else changes */
  }
}

/** The id to flash in `scope`, without using it up (safe to call twice in a render); null if none. */
export function peekFlash(scope: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const mark = window.sessionStorage.getItem(KEY);
    return mark && mark.startsWith(`${scope}#`) ? mark.slice(scope.length + 1) : null;
  } catch {
    return null;
  }
}

/** The mark is used: a reload of the list does not flash again. */
export function clearFlash(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
