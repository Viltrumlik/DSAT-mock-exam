"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  notificationsApi,
  type NotificationCategory,
  type NotificationPreferencesPatch,
} from "./notificationsApi";

const keys = {
  inbox: (category?: NotificationCategory | null) =>
    ["notifications", "inbox", category ?? "all"] as const,
  summary: ["notifications", "summary"] as const,
  pushConfig: ["notifications", "push-config"] as const,
  preferences: ["notifications", "preferences"] as const,
};

/**
 * The badge. Polls rather than depending on the realtime stream, for two reasons: the SSE
 * connection parks one of three sync gunicorn workers for its lifetime, so every viewer
 * holding one open to watch a dot is the wrong trade; and the realtime bus is explicitly
 * lossy for low-priority events. A 60s poll of one aggregate is cheap and always right.
 *
 * The realtime hint still helps when it arrives — `notifications.updated` invalidates this
 * key, which refetches immediately regardless of staleness.
 */
export function useUnreadSummary(enabled = true) {
  return useQuery({
    queryKey: keys.summary,
    queryFn: () => notificationsApi.summary(),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useNotifications(category?: NotificationCategory | null, enabled = true) {
  return useQuery({
    queryKey: keys.inbox(category),
    queryFn: () => notificationsApi.inbox(category),
    enabled,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { ids?: number[]; category?: NotificationCategory }) =>
      notificationsApi.markRead(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function usePushConfig() {
  return useQuery({
    queryKey: keys.pushConfig,
    queryFn: () => notificationsApi.pushConfig(),
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * The student's own switches. `/notifications/preferences/` has been a working GET/PATCH with
 * no client at all — the categories could be muted by the server and by nothing a student
 * could reach, so "turn this section off" was a feature only the API had.
 */
export function useNotificationPreferences(enabled = true) {
  return useQuery({
    queryKey: keys.preferences,
    queryFn: () => notificationsApi.getPreferences(),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Saves one change at a time and writes the server's answer straight back into the cache.
 *
 * `setQueryData` rather than an invalidate: the response body IS the new preferences, so
 * refetching would be a second round trip to learn what we were just told — and in the gap
 * the switches would snap back to their old positions under the student's finger.
 */
export function useSaveNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: NotificationPreferencesPatch) =>
      notificationsApi.patchPreferences(payload),
    onSuccess: (data) => {
      qc.setQueryData(keys.preferences, data);
      // Muting a section changes what the bell should be counting, so the badge and any open
      // inbox are no longer trustworthy.
      qc.invalidateQueries({ queryKey: ["notifications", "summary"] });
      qc.invalidateQueries({ queryKey: ["notifications", "inbox"] });
    },
  });
}
