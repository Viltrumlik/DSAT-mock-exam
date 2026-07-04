"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { normalizeApiError } from "@/lib/apiError";
import { useAuthCriticalGate } from "@/hooks/useAuthCriticalGate";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import { assessmentsStudentApi } from "@/features/assessmentsStudent/api";
import type { components } from "@/lib/openapi-types";
import { assessmentsKeys } from "./queryKeys";
import type { SaveAnswerResponse, SubmitResponse } from "@/features/assessments/schemas";

import type {
  AssessmentQuestion,
  AssessmentSet,
  Attempt,
  AttemptAnswerRequest,
  HomeworkAssignmentCreateRequest,
  Subject,
} from "./types";

export function useAssessmentSetsList(params?: { subject?: Subject; category?: string }) {
  return useQuery({
    queryKey: assessmentsKeys.setsList(params),
    queryFn: () => assessmentsAdminApi.listSets(params),
  });
}

export function useAssessmentSetDetail(setId: number) {
  return useQuery({
    queryKey: assessmentsKeys.setDetail(setId),
    queryFn: () => assessmentsAdminApi.getSet(setId),
    enabled: Number.isFinite(setId) && setId > 0,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function useUpsertAssessmentSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (x: { id?: number | null; payload: any }) => {
      if (x.id) return await assessmentsAdminApi.updateSet(x.id, x.payload);
      return await assessmentsAdminApi.createSet(x.payload);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: assessmentsKeys.sets() });
    },
    onError: (e) => {
      throw normalizeApiError(e);
    },
  });
}

export function useUpsertAssessmentQuestion(setId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (x: { id?: number | null; payload: any }) => {
      if (x.id) return await assessmentsAdminApi.updateQuestion(x.id, x.payload);
      return await assessmentsAdminApi.createQuestion(setId, x.payload);
    },
    onSuccess: (data) => {
      // Immediately patch the cached set-detail with the question data returned
      // by the mutation (the write serializer includes correct_answer).
      // This prevents the race condition where the editing form shows stale data
      // (e.g. no correct_answer) between the save and the background refetch.
      const savedQ = data as any;
      if (savedQ?.id && Number.isFinite(Number(savedQ.id))) {
        qc.setQueryData(assessmentsKeys.setDetail(setId), (old: any) => {
          if (!old) return old;
          const qs: any[] = Array.isArray(old.questions) ? old.questions : [];
          const exists = qs.some((q: any) => q.id === savedQ.id);
          const merged = exists
            ? qs.map((q: any) => (q.id === savedQ.id ? { ...q, ...savedQ } : q))
            : [...qs, savedQ]; // new question — append
          return { ...old, questions: merged };
        });
      }
      // Background refetch for a fully consistent server snapshot.
      // Not awaited — the cache patch above already ensures correct data is shown.
      void qc.invalidateQueries({ queryKey: assessmentsKeys.sets() });
      void qc.invalidateQueries({ queryKey: assessmentsKeys.setDetail(setId) });
    },
    onError: (e) => {
      throw normalizeApiError(e);
    },
  });
}

export function useDeleteAssessmentQuestion(setId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (questionId: number) => {
      await assessmentsAdminApi.deleteQuestion(questionId);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: assessmentsKeys.sets() });
      await qc.invalidateQueries({ queryKey: assessmentsKeys.setDetail(setId) });
    },
    onError: (e) => {
      throw normalizeApiError(e);
    },
  });
}

export function useAssignAssessmentHomework() {
  return useMutation({
    mutationFn: async (vars: { payload: HomeworkAssignmentCreateRequest; idempotencyKey?: string }) => {
      return await assessmentsAdminApi.assign(vars.payload, vars.idempotencyKey);
    },
    onError: (e) => {
      throw normalizeApiError(e);
    },
  });
}

export function useStartAttempt() {
  const { assertCriticalAuth } = useAuthCriticalGate();
  return useMutation({
    mutationFn: async (payload: { assignment_id?: number; homework_id?: number }): Promise<Attempt> => {
      if (!assertCriticalAuth()) {
        throw new Error("AUTH_ACTION_BLOCKED");
      }
      return await assessmentsStudentApi.start(payload);
    },
    onError: (e) => {
      throw normalizeApiError(e);
    },
  });
}

export function useSaveAnswer() {
  const qc = useQueryClient();
  const { assertCriticalAuth } = useAuthCriticalGate();
  return useMutation({
    mutationFn: async (payload: AttemptAnswerRequest): Promise<SaveAnswerResponse> => {
      if (!assertCriticalAuth()) {
        throw new Error("AUTH_ACTION_BLOCKED");
      }
      return await assessmentsStudentApi.saveAnswer(payload);
    },
    onSuccess: async (_data, vars) => {
      await qc.invalidateQueries({ queryKey: assessmentsKeys.attemptBundle(vars.attempt_id) });
    },
    onError: (e) => {
      throw normalizeApiError(e);
    },
  });
}

export function useSubmitAttempt() {
  const { assertCriticalAuth } = useAuthCriticalGate();
  return useMutation({
    mutationFn: async (payload: {
      attempt_id: number;
      question_times?: Record<number, number>;
    }): Promise<SubmitResponse> => {
      if (!assertCriticalAuth()) {
        throw new Error("AUTH_ACTION_BLOCKED");
      }
      return await assessmentsStudentApi.submit(payload as { attempt_id: number });
    },
    onError: (e) => {
      throw normalizeApiError(e);
    },
  });
}

export function useMyAssessmentResult(assignmentId: number, homeworkId?: number) {
  // When a homework id is given (a bundle can hold several assessments), fetch the
  // result for THAT specific assessment; otherwise fall back to the assignment route.
  const byHomework = Number.isFinite(homeworkId) && (homeworkId as number) > 0;
  return useQuery<components["schemas"]["AssessmentMyResultResponse"]>({
    queryKey: byHomework
      ? [...assessmentsKeys.myResult(assignmentId), "hw", homeworkId]
      : assessmentsKeys.myResult(assignmentId),
    queryFn: () =>
      byHomework
        ? assessmentsStudentApi.myResultByHomework(homeworkId as number)
        : assessmentsStudentApi.myResult(assignmentId),
    enabled: byHomework || (Number.isFinite(assignmentId) && assignmentId > 0),
    retry: (count, err: any) => {
      const status = err?.response?.status;
      if (status === 404) return false;
      return count < 1;
    },
  });
}

export function useAttemptBundle(attemptId: number) {
  return useQuery<components["schemas"]["AssessmentAttemptBundleResponse"]>({
    queryKey: assessmentsKeys.attemptBundle(attemptId),
    queryFn: () => assessmentsStudentApi.bundle(attemptId),
    enabled: Number.isFinite(attemptId) && attemptId > 0,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export type ValidationError = { scope: "set" | "question"; id?: number; field?: string; message: string };

export function validateSetClientSide(set: AssessmentSet | null): ValidationError[] {
  if (!set) return [{ scope: "set", message: "No set selected." }];
  const errs: ValidationError[] = [];
  if (!String(set.title || "").trim()) errs.push({ scope: "set", field: "title", message: "Title is required." });
  if (!String(set.subject || "").trim()) errs.push({ scope: "set", field: "subject", message: "Subject is required." });
  const qs = Array.isArray(set.questions) ? set.questions : [];
  if (!qs.length) errs.push({ scope: "set", message: "Add at least 1 question before publishing." });
  for (const q of qs) {
    if (!String(q.prompt || "").trim()) errs.push({ scope: "question", id: q.id, field: "prompt", message: "Prompt is required." });
    if (!String(q.question_type || "").trim()) errs.push({ scope: "question", id: q.id, field: "question_type", message: "Type is required." });
    if (q.question_type === "multiple_choice") {
      const choices = Array.isArray((q as any).choices) ? (q as any).choices : [];
      if (choices.length < 2) errs.push({ scope: "question", id: q.id, field: "choices", message: "MCQ needs at least 2 choices." });
    }
    if (q.question_type === "numeric") {
      // backend enforces correct_answer; we check for obvious missing value
      if ((q as any).correct_answer == null) errs.push({ scope: "question", id: q.id, field: "correct_answer", message: "Numeric requires a correct answer." });
    }
  }
  return errs;
}

