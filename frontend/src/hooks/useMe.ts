"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import type { AuthBootState } from "@/lib/auth/meBoot";
import {
  clearAuthLossDetected,
  fetchMeWithConcurrency,
  getAuthLossActive,
  getInteractionBlockedPackedSnapshot,
  markAuthLossDetected,
  recordAuthRefresh,
  setClientAuthBootState,
  setMeIdentityRefreshingActive,
  subscribeAuthConcurrency,
} from "@/lib/auth/authConcurrency";
import { classifyAuthLossReason } from "@/lib/auth/authLossReason";
import type { AuthLossReason } from "@/lib/auth/authLossReason";
import {
  broadcastAuthLostToOtherTabs,
  persistAuthNotice,
} from "@/lib/auth/authTabSync";
import { deriveAuthBootState, meErrorIsBenignCancellation, mePayloadValid } from "@/lib/auth/meBoot";
import { meQueryKey } from "@/lib/auth/meQueryKey";
import { clearAuthCircuitWindow } from "@/lib/auth/authCircuitBreaker";
import { clearDerivedAuthProjectionCookies, usersApi, writeLmsUserCacheFromMe } from "@/lib/api";

export function invalidateMe(queryClient: QueryClient) {
  // Do not cancel in-flight `/users/me` — overlapping aborts + `fetchMeWithConcurrency` stale
  // completions surface as `AbortError` and used to clear projection cookies while still logged in.
  return queryClient.invalidateQueries({ queryKey: [...meQueryKey] });
}

export function prefetchMe(queryClient: QueryClient) {
  return queryClient.prefetchQuery({
    queryKey: [...meQueryKey],
    queryFn: ({ signal }) => fetchMeWithConcurrency(queryClient, signal, usersApi.getMe),
  });
}

/**
 * Canonical `/users/me` observer (TanStack dedupes).
 *
 * Interaction blocking tiers:
 * - **Hard** (`globalInteractionBlockedHard`): unresolved auth loss or guarded `/users/me` overlap — mutations blocked.
 * - **Soft** (`globalInteractionBlockedSoft`): warm-cache identity refetch — lighter UX; mutations still allowed.
 * - **Combined** (`globalInteractionBlocked`): either tier — use for critical gates that must wait for refetch.
 */
export function useMe() {
  const queryClient = useQueryClient();
  const pathname = usePathname();

  const pathInitRef = useRef(false);

  useEffect(() => {
    if (!pathInitRef.current) {
      pathInitRef.current = true;
      return;
    }
    void invalidateMe(queryClient);
  }, [pathname, queryClient]);

  const interactionPacked = useSyncExternalStore(
    subscribeAuthConcurrency,
    getInteractionBlockedPackedSnapshot,
    () => 0,
  );
  const globalInteractionBlockedHard = (interactionPacked & 1) !== 0;
  const globalInteractionBlockedSoft = (interactionPacked & 2) !== 0;
  const globalInteractionBlocked = interactionPacked !== 0;

  const q = useQuery({
    queryKey: [...meQueryKey],
    queryFn: ({ signal }) => fetchMeWithConcurrency(queryClient, signal, usersApi.getMe),
    retry: (failureCount, err: unknown) => {
      if (meErrorIsBenignCancellation(err)) return false;
      const ax = err as { response?: { status?: number } };
      const status = ax.response?.status;
      if (status === 401 || status === 403) return false;
      if (status !== undefined && status >= 500) return failureCount < 1;
      if (!ax.response) return failureCount < 1;
      return false;
    },
    staleTime: 15_000,
  });

  const baseBootState = useMemo(
    () =>
      deriveAuthBootState({
        status: q.status,
        data: q.data,
        error: q.error,
      }),
    [q.status, q.data, q.error],
  );

  const bootState: AuthBootState = baseBootState;

  const lastAuthenticatedUserIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (bootState === "AUTHENTICATED" && mePayloadValid(q.data)) {
      lastAuthenticatedUserIdRef.current = q.data.id;
    }
  }, [bootState, q.data]);

  const isIdentityRefreshing = Boolean(
    q.isFetching && q.data !== undefined && mePayloadValid(q.data),
  );

  useEffect(() => {
    setClientAuthBootState(bootState);
  }, [bootState]);

  useEffect(() => {
    setMeIdentityRefreshingActive(isIdentityRefreshing);
    return () => setMeIdentityRefreshingActive(false);
  }, [isIdentityRefreshing]);

  const authLossReason = useMemo(
    (): AuthLossReason | null =>
      classifyAuthLossReason({
        queryStatus: q.status,
        data: q.data,
        error: q.error,
      }),
    [q.status, q.data, q.error],
  );

  const prevFetchingRef = useRef(q.isFetching);
  useEffect(() => {
    const wasFetching = prevFetchingRef.current;
    prevFetchingRef.current = q.isFetching;
    if (wasFetching && !q.isFetching && q.isSuccess && mePayloadValid(q.data)) {
      recordAuthRefresh();
    }
  }, [q.isFetching, q.isSuccess, q.data]);

  const everAuthenticatedRef = useRef(false);
  useEffect(() => {
    if (bootState === "AUTHENTICATED") everAuthenticatedRef.current = true;
  }, [bootState]);

  useEffect(() => {
    if (bootState === "AUTHENTICATED" && mePayloadValid(q.data)) {
      clearAuthLossDetected();
      clearAuthCircuitWindow();
    }
  }, [bootState, q.data]);

  useEffect(() => {
    if (bootState !== "UNAUTHENTICATED") return;
    if (!everAuthenticatedRef.current) return;
    everAuthenticatedRef.current = false;

    const reason =
      classifyAuthLossReason({
        queryStatus: q.status,
        data: q.data,
        error: q.error,
      }) ?? "NETWORK";
    persistAuthNotice(reason, lastAuthenticatedUserIdRef.current);

    // Only tell the OTHER tabs when the session is genuinely gone.
    //
    // `AuthTabSync` reacts to this broadcast with a hard `window.location.href = "/login"`
    // and no re-verification, so a broadcast is an eviction notice for every tab this user
    // has open. EXPIRED (401/403) and NO_SESSION (a 4xx or an unusable payload) have actually
    // established that the credential is dead, and are worth that.
    //
    // NETWORK and SERVER have established nothing of the kind. A dropped request, a 10s
    // timeout on a background `/users/me` refetch, or a 5xx says the server could not be
    // reached — not that the student is logged out. Broadcasting those turned one transient
    // blip in one tab into every tab jumping to the login screen at once, which is exactly
    // what "it kicks me out" describes, and it left no server-side trace because nothing on
    // the server ever returned 401.
    //
    // This tab still handles its own loss below; it simply stops evicting the others on a
    // guess. A genuinely expired session re-proves itself on the next request in each tab.
    if (reason === "EXPIRED" || reason === "NO_SESSION") {
      broadcastAuthLostToOtherTabs(reason, lastAuthenticatedUserIdRef.current);
    }
    // Interceptor / tab sync may already have marked loss — avoid second bump + duplicate telemetry.
    if (getAuthLossActive()) return;
    markAuthLossDetected(reason);
  }, [bootState, q.status, q.data, q.error]);

  const isAuthenticated = bootState === "AUTHENTICATED";

  useEffect(() => {
    if (q.isSuccess && mePayloadValid(q.data)) {
      writeLmsUserCacheFromMe(q.data, false);
    }
  }, [q.isSuccess, q.data]);

  useEffect(() => {
    if (!q.isError) return;
    if (meErrorIsBenignCancellation(q.error)) return;
    clearDerivedAuthProjectionCookies();
  }, [q.isError, q.error]);

  const me =
    bootState === "AUTHENTICATED" && mePayloadValid(q.data) ? q.data : undefined;

  return {
    ...q,
    bootState,
    isAuthenticated,
    me,
    authLossReason,
    isIdentityRefreshing,
    globalInteractionBlocked,
    globalInteractionBlockedHard,
    globalInteractionBlockedSoft,
  };
}
