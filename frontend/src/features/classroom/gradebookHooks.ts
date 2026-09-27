"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gradebookApi } from "./gradebookApi";
import { submittedWorkKey } from "./submissionsHooks";

const enabledId = (id: number) => Number.isFinite(id) && id > 0;
const keys = {
  overview: (c: number) => ["classroom", "gradebook", c] as const,
  assignment: (c: number, a: number) => ["classroom", "gradebook", c, a] as const,
};

export function useGradebookOverview(classId: number, enabled = true) {
  return useQuery({
    queryKey: keys.overview(classId),
    queryFn: () => gradebookApi.overview(classId),
    enabled: enabled && enabledId(classId),
  });
}

export function useGradebookAssignment(classId: number, assignmentId: number | null) {
  return useQuery({
    queryKey: keys.assignment(classId, assignmentId ?? 0),
    queryFn: () => gradebookApi.assignment(classId, assignmentId as number),
    enabled: enabledId(classId) && !!assignmentId,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, classId: number, assignmentId: number) {
  qc.invalidateQueries({ queryKey: keys.assignment(classId, assignmentId) });
  qc.invalidateQueries({ queryKey: keys.overview(classId) });
  // The work the mark was entered on, when a teacher has it open: its `composed_grade` is the
  // server's arithmetic over the mark that has just landed, and re-deriving that here to save a
  // round trip is exactly how the number would come to disagree with the student's.
  qc.invalidateQueries({ queryKey: submittedWorkKey(classId, assignmentId) });
}

export function useGradeSubmission(classId: number, assignmentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ submissionId, grade, feedback }: { submissionId: number; grade: string; feedback: string }) =>
      gradebookApi.grade(submissionId, { grade, feedback }),
    onSuccess: () => invalidate(qc, classId, assignmentId),
  });
}

export function useReturnSubmission(classId: number, assignmentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ submissionId, note }: { submissionId: number; note: string }) =>
      gradebookApi.returnForRevision(submissionId, { note }),
    onSuccess: () => invalidate(qc, classId, assignmentId),
  });
}
