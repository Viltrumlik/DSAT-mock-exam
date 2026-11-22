"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orgApi } from "./orgApi";

const keys = {
  regions: ["org", "regions"] as const,
  branches: ["org", "branches"] as const,
};

export function useOrgClassrooms() {
  return useQuery({ queryKey: ["org", "classrooms"], queryFn: () => orgApi.classrooms() });
}

export function useRegions() {
  return useQuery({ queryKey: keys.regions, queryFn: () => orgApi.regions() });
}

/** `enabled` false for a viewer the branches endpoint would refuse (the console's switcher asks only `manage_groups`). */
export function useBranches(enabled = true) {
  return useQuery({ queryKey: keys.branches, queryFn: () => orgApi.branches(), enabled });
}

export function useCreateRegion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; code?: string }) => orgApi.createRegion(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org"] }),
  });
}

export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; region: number; code?: string; address?: string }) =>
      orgApi.createBranch(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org"] }),
  });
}

/**
 * Assigning a classroom to a branch moves its whole roster onto a different leaderboard, so
 * this invalidates the leaderboard as well as the org lists — otherwise the board an admin
 * checks straight afterwards would still be the old one.
 */
export function useSetClassroomBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ classroomId, branchId }: { classroomId: number; branchId: number | null }) =>
      orgApi.setClassroomBranch(classroomId, branchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
      qc.invalidateQueries({ queryKey: ["ops", "classrooms"] });
    },
  });
}
