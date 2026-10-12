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
