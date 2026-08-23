import type { AxiosError } from "axios";

export type AuthBootState = "BOOTING" | "AUTHENTICATED" | "UNAUTHENTICATED";

/**
 * Axios/RQ abort – not a session failure; do not clear `lms_user` projection cookies.
 * Covers: axios cancel, TanStack cancel, `fetchMeWithConcurrency` stale-completion `AbortError`,
 * and generic DOMException `AbortError` from `signal.abort()`.
 */
export function meErrorIsBenignCancellation(err: unknown): boolean {
  const ax = err as AxiosError;
  if (ax?.code === "ERR_CANCELED") return true;
  if (err instanceof Error && err.name === "CanceledError") return true;
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") {
    return true;
  }
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

export function mePayloadValid(data: unknown): data is Record<string, unknown> & { id: number } {
  return !!data && typeof data === "object" && typeof (data as { id?: unknown }).id === "number";
}

/**
 * Map React Query observers to coarse boot gates.
 *
 * There is deliberately no terminal `ERROR` state — the UI must never be stuck waiting on
 * retries — so an unresolvable probe ends at UNAUTHENTICATED.
 *
 * **But an error does not outrank a session we are already holding.** This branch used to
 * come first and return UNAUTHENTICATED for any `status === "error"`, which meant a warm,
 * fully authenticated tab was evicted by a *background refetch* failing: React Query keeps
 * `data` and merely flags the query errored, so a 10s timeout or a dropped request on a
 * routine `/users/me` poll logged the student out. Nothing on the server ever returned 401,
 * which is why an incident like that leaves no trace in an access log.
 *
 * So: a credential the server actually rejected (401/403) evicts even with data cached,
 * because that is the one error that has established the session is dead. Everything else —
 * a 5xx, a timeout, an offline blip — leaves an existing valid payload standing and lets the
 * next poll settle it.
 */
export function deriveAuthBootState(opts: {
  status: string;
  data: unknown;
  error: unknown | null | undefined;
}): AuthBootState {
  const { status, data, error } = opts;

  if (status === "error") {
    const rejectedStatus = (error as AxiosError | undefined)?.response?.status;
    // The server said this credential is no good. Evict, cached payload or not.
    if (rejectedStatus === 401 || rejectedStatus === 403) return "UNAUTHENTICATED";
    // Any other failure says we could not reach the server, not that the session ended.
    if (mePayloadValid(data)) return "AUTHENTICATED";
    return "UNAUTHENTICATED";
  }

  // Pending or success with cached `me` (e.g. background refetch) — avoid boot shell / cookie churn.
  if (mePayloadValid(data)) return "AUTHENTICATED";

  if (status === "pending") return "BOOTING";

  if (status === "success") {
    return "UNAUTHENTICATED";
  }

  return "BOOTING";
}
