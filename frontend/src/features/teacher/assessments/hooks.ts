"use client";

import { useQuery } from "@tanstack/react-query";
import { listTeacherAssessments } from "./api";

const KEY = ["teacher", "assessments"] as const;

/**
 * The library, through the shared client. The page used to own a `useEffect` with its own
 * `loading`/`error` pair, which is how the failure and the empty case ended up as two sibling
 * blocks that could both render at once; here the three states are one value and cannot
 * disagree, and `refetch` is what the retry in `ErrorState` calls.
 */
export function useTeacherAssessments() {
  return useQuery({ queryKey: KEY, queryFn: listTeacherAssessments, staleTime: 60_000 });
}
