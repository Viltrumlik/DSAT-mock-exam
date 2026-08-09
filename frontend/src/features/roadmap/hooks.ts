"use client";

import { useQuery } from "@tanstack/react-query";
import { classesApi } from "@/lib/api";
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
