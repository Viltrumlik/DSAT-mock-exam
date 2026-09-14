"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { homeworkApi } from "./homeworkApi";

const enabledId = (id: number) => Number.isFinite(id) && id > 0;
const keys = {
  assignment: (c: number, a: number) => ["classroom", "homework", "assignment", c, a] as const,
  mySubmission: (c: number, a: number) => ["classroom", "homework", "my-submission", c, a] as const,
};

export function useAssignment(classId: number, assignmentId: number) {
  return useQuery({
    queryKey: keys.assignment(classId, assignmentId),
    queryFn: () => homeworkApi.getAssignment(classId, assignmentId),
    enabled: enabledId(classId) && enabledId(assignmentId),
  });
}

export function useMySubmission(classId: number, assignmentId: number, enabled = true) {
  return useQuery({
    queryKey: keys.mySubmission(classId, assignmentId),
    queryFn: () => homeworkApi.getMySubmission(classId, assignmentId),
    enabled: enabled && enabledId(classId) && enabledId(assignmentId),
  });
}

export function useSubmitHomework(classId: number, assignmentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) => homeworkApi.submit(classId, assignmentId, formData),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.mySubmission(classId, assignmentId) }),
  });
}

export function useAssignmentLifecycle(classId: number, assignmentId: number) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: keys.assignment(classId, assignmentId) });
    qc.invalidateQueries({ queryKey: ["classroom", "gradebook", classId] });
    qc.invalidateQueries({ queryKey: ["classroom", "assignments", classId] });
  };
  return {
    publish: useMutation({ mutationFn: () => homeworkApi.publish(classId, assignmentId), onSuccess: invalidate }),
    archive: useMutation({ mutationFn: () => homeworkApi.archive(classId, assignmentId), onSuccess: invalidate }),
    unarchive: useMutation({ mutationFn: () => homeworkApi.unarchive(classId, assignmentId), onSuccess: invalidate }),
  };
}
