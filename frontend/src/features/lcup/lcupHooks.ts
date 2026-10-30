"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lcupApi, type StudentFilter } from "./lcupApi";

const ROOT = ["lcup"] as const;

export const lcupKeys = {
  status: [...ROOT, "status"] as const,
  groups: [...ROOT, "groups"] as const,
  students: (filter: StudentFilter) => [...ROOT, "students", filter] as const,
  teachers: [...ROOT, "teachers"] as const,
  unlinked: [...ROOT, "unlinked"] as const,
  accounts: [...ROOT, "accounts"] as const,
  attendancePushes: [...ROOT, "attendance-pushes"] as const,
  followups: [...ROOT, "followups"] as const,
  archive: [...ROOT, "archive"] as const,
};

/** Polled: a queued sync finishes in the worker, and the run list is where it shows up. */
export function useLcupStatus() {
  return useQuery({ queryKey: lcupKeys.status, queryFn: () => lcupApi.status(), refetchInterval: 20_000 });
}

export function useLcupGroups() {
  return useQuery({ queryKey: lcupKeys.groups, queryFn: () => lcupApi.groups() });
}

export function useLcupStudents(filter: StudentFilter) {
  return useQuery({ queryKey: lcupKeys.students(filter), queryFn: () => lcupApi.students(filter) });
}

export function useLcupTeachers() {
  return useQuery({ queryKey: lcupKeys.teachers, queryFn: () => lcupApi.teachers() });
}

export function useLcupUnlinked() {
  return useQuery({ queryKey: lcupKeys.unlinked, queryFn: () => lcupApi.unlinkedMembers() });
}

export function useLcupAttendancePushes() {
  return useQuery({ queryKey: lcupKeys.attendancePushes, queryFn: () => lcupApi.attendancePushes() });
}

/** /ops/trials and the sidebar's count share this one query; a minute is fresh enough for a desk. */
export function useLcupFollowups(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: lcupKeys.followups,
    queryFn: () => lcupApi.followups(),
    refetchInterval: 60_000,
    enabled: options.enabled ?? true,
  });
}

export function useLcupArchive() {
  return useQuery({ queryKey: lcupKeys.archive, queryFn: () => lcupApi.archive() });
}

export function useLcupAccounts() {
  return useQuery({ queryKey: lcupKeys.accounts, queryFn: () => lcupApi.accounts() });
}

/**
 * Any write on this page. One link changes the counts, the queues and which classes are still
 * free to pair, so everything under ["lcup"] is refetched rather than guessing which list moved.
 */
export function useLcupAction<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ROOT }) });
}
