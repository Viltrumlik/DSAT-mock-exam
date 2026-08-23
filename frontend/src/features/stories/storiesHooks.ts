"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { storiesApi } from "./storiesApi";

const keys = {
  rail: ["stories", "rail"] as const,
  admin: ["stories", "admin"] as const,
};

/**
 * The student rail.
 *
 * `staleTime` is deliberately generous. A story is a noticeboard, not a feed — nothing about
 * it changes between one dashboard render and the next, and refetching a list of school
 * announcements on every window focus buys nothing and costs a signed-URL round trip.
 */
export function useStoryRail() {
  return useQuery({
    queryKey: keys.rail,
    queryFn: () => storiesApi.rail(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAdminStories() {
  return useQuery({ queryKey: keys.admin, queryFn: () => storiesApi.adminStories() });
}

/**
 * Saving invalidates the rail as well as the console.
 *
 * An admin who unticks a story and still sees it on their own dashboard has no way to tell
 * whether the change landed, so the two lists must never be allowed to disagree — even
 * though the person editing is rarely the person looking at the rail.
 */
export function useSaveStory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: number; body: FormData | Record<string, unknown> }) =>
      id ? storiesApi.updateStory(id, body) : storiesApi.createStory(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stories"] });
    },
  });
}

export function useDeleteStory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => storiesApi.deleteStory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stories"] });
    },
  });
}
