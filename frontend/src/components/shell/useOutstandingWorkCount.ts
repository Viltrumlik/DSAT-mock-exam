"use client";

import { useQuery } from "@tanstack/react-query";
import { classesApi } from "@/lib/api";

type Row = { workflow_status?: string | null; due_at?: string | null };

/** Submitted and graded work is done. RETURNED is not — it means revise and resubmit. */
function isOutstanding(status?: string | null): boolean {
  return !["submitted", "graded"].includes((status || "").trim().toLowerCase());
}

/**
 * How many pieces of homework are still to do, for the "My work" badge.
 *
 * Shares `["classes","my-assignments"]` with nothing else today, but it is the same request
 * the work board makes, so a student who navigates between them pays for it once. The stale
 * window keeps the sidebar from refetching on every route change.
 */
export function useOutstandingWorkCount(enabled: boolean): number {
  const q = useQuery({
    queryKey: ["classes", "my-assignments", "outstanding"],
    queryFn: async () => {
      const { items } = await classesApi.myAssignments();
      return (items as Row[]).filter((a) => isOutstanding(a.workflow_status)).length;
    },
    enabled,
    staleTime: 60_000,
  });
  return q.data ?? 0;
}
