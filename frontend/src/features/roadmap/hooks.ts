"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { classesApi } from "@/lib/api";
import { roadmapReadingApi, type RoadmapReading } from "./readingApi";
import type { RoadmapResponse } from "./types";

export const roadmapKeys = {
  all: ["roadmap"] as const,
};

/** The student's per-subject level ladder. */
export function useRoadmap() {
  return useQuery<RoadmapResponse>({
    queryKey: roadmapKeys.all,
    queryFn: () => classesApi.roadmap(),
  });
}


/** Whether `id` could name a delivery at all. Shared by the route guard and the query gate,
 *  so a bad URL cannot leave a disabled query reporting "pending" forever. */
export function isValidDeliveryId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

/** One lesson's reading. */
export function useRoadmapReading(deliveryId: number) {
  return useQuery<RoadmapReading>({
    queryKey: [...roadmapKeys.all, "reading", deliveryId],
    queryFn: () => roadmapReadingApi.get(deliveryId),
    enabled: isValidDeliveryId(deliveryId),
  });
}

/** "I've finished reading" — writes the mark and returns the payload with the homework id. */
export function useMarkRoadmapRead(deliveryId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => roadmapReadingApi.markRead(deliveryId),
    onSuccess: (data) => {
      // Seeded, not just invalidated: the response already IS the new state, and a refetch
      // would blank the page for a moment on the one interaction the feature has.
      qc.setQueryData([...roadmapKeys.all, "reading", deliveryId], data);
      // The ladder shows a "read" tick per lesson, so it is stale the moment this lands.
      qc.invalidateQueries({ queryKey: roadmapKeys.all });
    },
  });
}
