"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { examsAdminApi } from "@/lib/api";
import { questionsModuleKeys } from "./queryKeys";
import type { AdminModuleQuestion } from "./types";

/**
 * Adapter that lets ModuleQuestionsPanel drive DIFFERENT backends with the same UI.
 * The two ids are (container, module): for exams that's (practiceTestId, moduleId);
 * for full mocks that's (mockId, moduleId). `source` namespaces the react-query cache
 * so ids never collide across backends. Default is the exams practice-test backend.
 */
export type ModuleQuestionsApi = {
  source: string;
  getQuestions: (a: number, b: number) => Promise<unknown>;
  createQuestion: (a: number, b: number, data: object | FormData, isFormData: boolean) => Promise<unknown>;
  updateQuestion: (
    a: number,
    b: number,
    questionId: number,
    data: (Partial<AdminModuleQuestion> & Record<string, unknown>) | FormData,
    isFormData: boolean,
  ) => Promise<unknown>;
  deleteQuestion: (a: number, b: number, questionId: number) => Promise<unknown>;
  reorderQuestionsBulk: (a: number, b: number, orderedIds: number[]) => Promise<unknown>;
};

export const examsModuleQuestionsApi: ModuleQuestionsApi = {
  source: "exams",
  getQuestions: (t, m) => examsAdminApi.getQuestions(t, m),
  createQuestion: (t, m, data, isFormData) => examsAdminApi.createQuestion(t, m, data, isFormData),
  updateQuestion: (t, m, qid, data, isFormData) => examsAdminApi.updateQuestion(t, m, qid, data, isFormData),
  deleteQuestion: (t, m, qid) => examsAdminApi.deleteQuestion(t, m, qid),
  reorderQuestionsBulk: (t, m, ids) => examsAdminApi.reorderQuestionsBulk(t, m, ids),
};

function unwrapQuestionsList(data: unknown): AdminModuleQuestion[] {
  if (Array.isArray(data)) return data as AdminModuleQuestion[];
  if (data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)) {
    return (data as { results: AdminModuleQuestion[] }).results;
  }
  return [];
}

/** Uses backend ordering only (see AdminQuestionViewSet.get_queryset ``order_by``). */
export function useModuleQuestionsQuery(
  testId: number,
  moduleId: number,
  api: ModuleQuestionsApi = examsModuleQuestionsApi,
) {
  return useQuery({
    queryKey: questionsModuleKeys.list(api.source, testId, moduleId),
    queryFn: async () => unwrapQuestionsList(await api.getQuestions(testId, moduleId)),
    enabled: Number.isFinite(testId) && testId > 0 && Number.isFinite(moduleId) && moduleId > 0,
    staleTime: 0,
  });
}

/**
 * Atomically reorder all questions in a module via a single POST.
 * Pass the complete ordered array of question IDs — partial reorders are rejected by the server.
 */
export function useReorderModuleQuestionsBulk(
  testId: number,
  moduleId: number,
  api: ModuleQuestionsApi = examsModuleQuestionsApi,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: number[]) => {
      await api.reorderQuestionsBulk(testId, moduleId, orderedIds);
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: questionsModuleKeys.list(api.source, testId, moduleId) });
    },
  });
}

/** Backend merges defaults for omitted fields (subject from module's practice test). Send `{}`. */
export function useCreateModuleQuestion(
  testId: number,
  moduleId: number,
  api: ModuleQuestionsApi = examsModuleQuestionsApi,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => api.createQuestion(testId, moduleId, {}, false),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: questionsModuleKeys.list(api.source, testId, moduleId) });
    },
  });
}

export function useUpdateModuleQuestion(
  testId: number,
  moduleId: number,
  api: ModuleQuestionsApi = examsModuleQuestionsApi,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { questionId: number; data: (Partial<AdminModuleQuestion> & Record<string, unknown>) | FormData }) => {
      const isFormData = args.data instanceof FormData;
      return api.updateQuestion(testId, moduleId, args.questionId, args.data, isFormData) as Promise<AdminModuleQuestion>;
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: questionsModuleKeys.list(api.source, testId, moduleId) });
    },
  });
}

export function useDeleteModuleQuestion(
  testId: number,
  moduleId: number,
  api: ModuleQuestionsApi = examsModuleQuestionsApi,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (questionId: number) => {
      await api.deleteQuestion(testId, moduleId, questionId);
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: questionsModuleKeys.list(api.source, testId, moduleId) });
    },
  });
}
