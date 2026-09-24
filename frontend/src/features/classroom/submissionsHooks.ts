"use client";

import { useQuery } from "@tanstack/react-query";
import { submissionsApi } from "./submissionsApi";

/**
 * Keyed by homework, not by student: opening thirty students in a row is one read, and the walk
 * from one to the next costs nothing. Its own key rather than the teacher panel's — sharing that
 * one would mean importing the teacher grading screen into shared classroom code.
 */
export const submittedWorkKey = (classId: number, assignmentId: number) =>
  ["classroom", "submitted-work", classId, assignmentId] as const;

/**
 * The work turned in on one homework.
 *
 * `enabled` is the third level being open. The read is deliberately not made by the two levels
 * above it: this GET runs a lazy whole-class sync on the way past, and the assignments list and
 * the class list must not pay for it.
 */
export function useSubmittedWork(classId: number, assignmentId: number, enabled: boolean) {
  return useQuery({
    queryKey: submittedWorkKey(classId, assignmentId),
    queryFn: () => submissionsApi.forAssignment(classId, assignmentId),
    enabled: enabled && Number.isFinite(classId) && classId > 0 && assignmentId > 0,
    // A failed read must reach the error state with its retry, not spin behind a silent retry
    // the teacher cannot see — and it must never be drawn as work nobody turned in.
    retry: false,
    staleTime: 30_000,
  });
}
