"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { classroomKeys } from "./queryKeys";
import { lessonsApi, type LessonBlock, type LessonResourceType } from "./lessonsApi";

const enabledId = (id: number) => Number.isFinite(id) && id > 0;

export function useLessonPlan(classId: number) {
  return useQuery({
    queryKey: classroomKeys.lessons(classId),
    queryFn: () => lessonsApi.plan(classId),
    enabled: enabledId(classId),
  });
}

export function useLessonDetail(classId: number, lessonId: number | null) {
  return useQuery({
    queryKey: classroomKeys.lesson(classId, lessonId ?? 0),
    queryFn: () => lessonsApi.detail(classId, lessonId as number),
    enabled: enabledId(classId) && enabledId(lessonId ?? 0),
  });
}

/** Refresh both the list and the open lesson — a grant changes state in both. */
function useLessonInvalidator(classId: number, lessonId: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: classroomKeys.lessons(classId) });
    qc.invalidateQueries({ queryKey: classroomKeys.lesson(classId, lessonId) });
    // Handing work out creates an Assignment, so that tab is stale too.
    qc.invalidateQueries({ queryKey: classroomKeys.assignments(classId) });
  };
}

/** True when the server refused because the content has not passed review. */
export function isNotApproved(e: unknown): boolean {
  const data = (e as { response?: { data?: { code?: string } } })?.response?.data;
  return data?.code === "assessment_not_approved";
}

export function useReleaseHomework(classId: number, lessonId: number) {
  const invalidate = useLessonInvalidator(classId, lessonId);
  return useMutation({
    mutationFn: (allowUnapproved: boolean = false) =>
      lessonsApi.release(classId, lessonId, allowUnapproved),
    onSuccess: (data: { created?: boolean; detail?: string }) => {
      invalidate();
      pushGlobalToast({
        tone: data?.created ? "success" : "neutral",
        message: data?.detail || "Homework given to the class.",
      });
    },
    onError: (e) => {
      if (isNotApproved(e)) return;
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    },
  });
}

export function useGrantItem(classId: number, lessonId: number) {
  const invalidate = useLessonInvalidator(classId, lessonId);
  return useMutation({
    mutationFn: (vars: {
      block: LessonBlock;
      resource_type: LessonResourceType;
      resource_id: number;
      allowUnapproved?: boolean;
    }) => {
      const { allowUnapproved, ...body } = vars;
      return lessonsApi.grant(classId, lessonId, body, allowUnapproved);
    },
    onSuccess: (data: { created?: boolean; detail?: string }) => {
      invalidate();
      pushGlobalToast({
        tone: data?.created ? "success" : "neutral",
        message: data?.detail || "Class can now access this.",
      });
    },
    onError: (e) => {
      // `assessment_not_approved` is a question, not a failure: the panel catches it and
      // asks the teacher to confirm, so don't shout it as an error toast.
      if (isNotApproved(e)) return;
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
    },
  });
}

export function useGrantMidterm(classId: number, lessonId: number) {
  const invalidate = useLessonInvalidator(classId, lessonId);
  return useMutation({
    mutationFn: () => lessonsApi.grantMidterm(classId, lessonId),
    onSuccess: (data: { needs_start_code?: boolean; detail?: string }) => {
      invalidate();
      pushGlobalToast({
        tone: "success",
        message: data?.needs_start_code
          ? "Access granted. Generate the start code to let students begin."
          : data?.detail || "Class can now access the midterm.",
      });
    },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });
}

export function useRevokeGrant(classId: number, lessonId: number) {
  const invalidate = useLessonInvalidator(classId, lessonId);
  return useMutation({
    mutationFn: (grantId: number) => lessonsApi.revoke(classId, lessonId, grantId),
    onSuccess: () => {
      invalidate();
      pushGlobalToast({ tone: "neutral", message: "Withdrawn." });
    },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });
}

export function useRescheduleLessons(classId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (startsOn: string) => lessonsApi.reschedule(classId, startsOn),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: classroomKeys.lessons(classId) });
      pushGlobalToast({ tone: "success", message: "Plan rescheduled." });
    },
    onError: (e) => pushGlobalToast({ tone: "error", message: normalizeApiError(e).message }),
  });
}
