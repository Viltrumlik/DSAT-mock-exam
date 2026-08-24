"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { opsSupportApi, type SupportWorkingDay } from "./opsSupportApi";

const keys = {
  teachers: ["ops-support", "teachers"] as const,
  workingHours: (id: number) => ["ops-support", "working-hours", id] as const,
};

export function useSupportTeachers() {
  return useQuery({ queryKey: keys.teachers, queryFn: () => opsSupportApi.teachers() });
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
    onSuccess: () => {
      if (supportTeacherId != null) {
        void qc.invalidateQueries({ queryKey: keys.workingHours(supportTeacherId) });
      }
    },
  });
}
