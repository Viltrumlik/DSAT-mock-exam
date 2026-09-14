"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { telegramGroupApi, type TelegramGroupState } from "./telegramApi";

const keys = {
  state: (classId: number) => ["classroom", "telegram", classId] as const,
};

export function useTelegramGroup(classId: number, enabled = true) {
  return useQuery({
    queryKey: keys.state(classId),
    queryFn: () => telegramGroupApi.state(classId),
    enabled: enabled && Number.isFinite(classId) && classId > 0,
    // The invite has a short life and the status changes in Telegram, not here, so a cached
    // answer goes stale the moment the student leaves the tab.
    staleTime: 0,
  });
}

/**
 * The deep link that introduces this student to the bot, fetched once the dialog knows they
 * need one. A mutation rather than a query because each call spends the previous token: two
 * live links mean two accounts could bind, and only one of them is holding the screen.
 */
export function useTelegramBotLink(classId: number) {
  return useMutation({
    mutationFn: () => telegramGroupApi.botLink(classId),
  });
}

export function useJoinTelegramGroup(classId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => telegramGroupApi.join(classId),
    onSuccess: (data: TelegramGroupState) => {
      // Seed rather than invalidate: the response IS the new state, and a refetch would
      // race the link the student is about to click.
      qc.setQueryData(keys.state(classId), data);
    },
  });
}
