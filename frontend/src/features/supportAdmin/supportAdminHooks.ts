"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supportAdminApi } from "./supportAdminApi";

const keys = {
  all: ["supportAdmin"] as const,
  overview: ["supportAdmin", "overview"] as const,
  week: (id: number) => ["supportAdmin", "week", id] as const,
  ratings: (id: number) => ["supportAdmin", "ratings", id] as const,
};

export function useSupportDeskOverview() {
  return useQuery({ queryKey: keys.overview, queryFn: () => supportAdminApi.overview() });
}

/** One teacher's week. `enabled` off until a teacher is picked — an id of 0 would ask the
 *  server about nobody and get a 400 back for it. */
export function useSupportDeskWeek(supportTeacherId: number | null) {
  return useQuery({
    queryKey: keys.week(supportTeacherId ?? 0),
    queryFn: () => supportAdminApi.week(supportTeacherId as number),
    enabled: supportTeacherId != null,
  });
}

export function useSupportDeskRatings(supportTeacherId: number | null) {
  return useQuery({
    queryKey: keys.ratings(supportTeacherId ?? 0),
    queryFn: () => supportAdminApi.ratings(supportTeacherId as number),
    enabled: supportTeacherId != null,
  });
}

/**
 * Set one hour on somebody else's calendar.
 *
 * Invalidates the overview as well as the week: the overview's free/withdrawn hour counts
 * are computed from exactly the rows this write moves, so leaving it alone would show a
 * table that disagreed with the grid immediately underneath it.
 *
 * It also invalidates the teacher-side `["support", ...]` keys. Those belong to a different
 * console on a different host and will almost never be mounted in this browser — but if an
 * admin who is also a support teacher ever has both open, a stale grid is the one thing
 * that would make them withdraw an hour twice.
 */
export function useSetDeskHour(supportTeacherId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      action: "close" | "open";
      startsAt: string;
      capacity?: number;
      note?: string;
    }) =>
      supportAdminApi.setHour(supportTeacherId as number, vars.action, vars.startsAt, {
        capacity: vars.capacity,
        note: vars.note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.invalidateQueries({ queryKey: ["support"] });
    },
  });
}
