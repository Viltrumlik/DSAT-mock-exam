"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { opsSupportApi, type SupportWorkingDay } from "./opsSupportApi";

const keys = {
  teachers: ["ops-support", "teachers"] as const,
  week: (id: number) => ["ops-support", "week", id] as const,
  workingHours: (id: number) => ["ops-support", "working-hours", id] as const,
};

export function useSupportTeachers() {
  return useQuery({ queryKey: keys.teachers, queryFn: () => opsSupportApi.teachers() });
}

export function useSupportWeek(supportTeacherId: number | null) {
  return useQuery({
    queryKey: keys.week(supportTeacherId ?? 0),
    queryFn: () => opsSupportApi.week(supportTeacherId as number),
    enabled: supportTeacherId != null,
  });
}

export function useSupportWorkingHours(supportTeacherId: number | null) {
  return useQuery({
    queryKey: keys.workingHours(supportTeacherId ?? 0),
    queryFn: () => opsSupportApi.workingHours(supportTeacherId as number),
    enabled: supportTeacherId != null,
  });
}

export function useSetSupportWorkingHours(supportTeacherId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: SupportWorkingDay[]) =>
      opsSupportApi.setWorkingHours(supportTeacherId as number, days),
    // The dated grid below the form is DERIVED from this schedule, so it has to be re-read
    // too — otherwise saving "Wednesdays 10–2" leaves the four-day preview still showing the
    // old hours and the admin cannot tell whether the save took.
    onSuccess: () => {
      if (supportTeacherId != null) {
        void qc.invalidateQueries({ queryKey: keys.workingHours(supportTeacherId) });
        void qc.invalidateQueries({ queryKey: keys.week(supportTeacherId) });
      }
    },
  });
}

export function useSetSupportHour(supportTeacherId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      startsAt: string;
      action: "open" | "close";
      capacity?: number;
      note?: string;
    }) => opsSupportApi.setHour({ supportTeacherId: supportTeacherId as number, ...input }),
    // Refetch rather than patch the cache: closing an hour that already holds bookings is
    // answered by the server with the bookings intact, and guessing that locally would show
    // an admin a grid the students do not have.
    onSuccess: () => {
      if (supportTeacherId != null) {
        void qc.invalidateQueries({ queryKey: keys.week(supportTeacherId) });
      }
    },
  });
}
