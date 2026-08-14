"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationsApi, type NotificationCategory } from "./notificationsApi";

const keys = {
  inbox: (category?: NotificationCategory | null) =>
    ["notifications", "inbox", category ?? "all"] as const,
  summary: ["notifications", "summary"] as const,
  pushConfig: ["notifications", "push-config"] as const,
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
