"use client";

import { useQuery } from "@tanstack/react-query";
import { classesApi } from "@/lib/api";
import type { InterventionsPayload } from "./overviewModel";

/**
 * The intervention signals for ONE classroom — the same endpoint the teacher panel's dashboard
 * and analytics already read, asked for a single class instead of fanned out over all of them.
 *
 * It lives here rather than in `features/classroom/*` on purpose: the endpoint is staff-only
 * server-side, and this overview is the only classroom surface that reads it. Putting the hook
 * beside a student-visible one would make it far too easy to mount on the student site, where
 * every call would be a 403.
 */
export function useClassInterventions(classId: number) {
  return useQuery<InterventionsPayload>({
    queryKey: ["classroom", "interventions", classId] as const,
    queryFn: () => classesApi.getInterventions(classId) as Promise<InterventionsPayload>,
    enabled: Number.isFinite(classId) && classId > 0,
  });
}
