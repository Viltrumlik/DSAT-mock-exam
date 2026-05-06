"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { examsAdminApi } from "@/lib/api";
import { questionBankKeys } from "./queryKeys";
import type {
  ActiveFilter,
  AdminCategory,
  AdminStandaloneQuestion,
  LifecycleStatusFilter,
  QuestionModuleLink,
  SubjectFilter,
} from "./types";

function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)) {
    return (data as { results: T[] }).results;
  }
  return [];
}

export function useQuestionBankCategories() {
  return useQuery({
    queryKey: questionBankKeys.categories(),
    queryFn: async () => unwrapList<AdminCategory>(await examsAdminApi.getCategoriesAdmin()),
    staleTime: 0,
  });
}

export function useQuestionBankQuestions(args: {
  q: string;
  categoryId: number | "all";
  subject: SubjectFilter;
  isActive: ActiveFilter;
  lifecycleStatus?: LifecycleStatusFilter;
}) {
  const lifecycleStatus = args.lifecycleStatus ?? "all";
  const listArgs = { ...args, lifecycleStatus };
  return useQuery({
    queryKey: questionBankKeys.list(listArgs),
    queryFn: async () =>
      unwrapList<AdminStandaloneQuestion>(
        await examsAdminApi.listStandaloneQuestions({
          standalone: "1",
          q: args.q || undefined,
          category: args.categoryId,
          subject: args.subject,
          is_active: args.isActive,
          status: lifecycleStatus === "all" ? undefined : lifecycleStatus,
        }),
      ),
    staleTime: 0,
  });
}

export function useQuestionBankTests() {
  return useQuery({
    queryKey: questionBankKeys.tests(),
    queryFn: async () => unwrapList<{ id: number; title?: string }>(await examsAdminApi.getPracticeTestsAdmin(true)),
    staleTime: 0,
  });
}

export function useQuestionBankModules(testId: number) {
  return useQuery({
    queryKey: questionBankKeys.modules(testId),
    queryFn: async () => unwrapList<{ id: number; module_order: number }>(await examsAdminApi.getModules(testId)),
    enabled: Number.isFinite(testId) && testId > 0,
    staleTime: 0,
  });
}

export function useArchiveStandaloneQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { questionId: number; isActive: boolean }) => {
      return await examsAdminApi.updateStandaloneQuestion(args.questionId, { is_active: args.isActive });
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: questionBankKeys.all });
    },
  });
}

export function useAssignStandaloneQuestionToModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { testId: number; moduleId: number; questionId: number }) => {
      return await examsAdminApi.assignStandaloneQuestionToModule(args.testId, args.moduleId, {
        question_id: args.questionId,
      });
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: questionBankKeys.all });
    },
  });
}

export function useStandaloneQuestion(questionId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: questionId ? questionBankKeys.detail(questionId) : ["questionBank", "detail", "disabled"],
    queryFn: async () => (await examsAdminApi.getStandaloneQuestion(questionId!)) as AdminStandaloneQuestion,
    enabled: Boolean(enabled && questionId && questionId > 0),
    staleTime: 0,
  });
}

export function useQuestionModuleLinks(questionId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: questionId ? questionBankKeys.moduleLinks(questionId) : ["questionBank", "moduleLinks", "disabled"],
    queryFn: async () => {
      const data = await examsAdminApi.getStandaloneQuestionModuleLinks(questionId!);
      return Array.isArray(data) ? (data as QuestionModuleLink[]) : [];
    },
    enabled: Boolean(enabled && questionId && questionId > 0),
    staleTime: 0,
  });
}

export function useCreateStandaloneQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return (await examsAdminApi.createStandaloneQuestion(data)) as AdminStandaloneQuestion;
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: questionBankKeys.all });
    },
  });
}

export function usePatchStandaloneQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { questionId: number; data: Record<string, unknown> }) => {
      return await examsAdminApi.updateStandaloneQuestion(args.questionId, args.data);
    },
    onSuccess: async (_data, args) => {
      await qc.invalidateQueries({ queryKey: questionBankKeys.all });
      await qc.invalidateQueries({ queryKey: questionBankKeys.detail(args.questionId) });
    },
  });
}

export function useSubmitStandaloneQuestionForReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (questionId: number) => examsAdminApi.submitStandaloneQuestionForReview(questionId),
    onSettled: async (_d, _e, questionId) => {
      await qc.invalidateQueries({ queryKey: questionBankKeys.all });
      await qc.invalidateQueries({ queryKey: questionBankKeys.detail(questionId) });
    },
  });
}

export function useApproveStandaloneQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (questionId: number) => examsAdminApi.approveStandaloneQuestion(questionId),
    onSettled: async (_d, _e, questionId) => {
      await qc.invalidateQueries({ queryKey: questionBankKeys.all });
      await qc.invalidateQueries({ queryKey: questionBankKeys.detail(questionId) });
    },
  });
}

export function useRejectStandaloneQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { questionId: number; comment?: string }) =>
      examsAdminApi.rejectStandaloneQuestion(args.questionId, args.comment),
    onSettled: async (_d, _e, args) => {
      await qc.invalidateQueries({ queryKey: questionBankKeys.all });
      await qc.invalidateQueries({ queryKey: questionBankKeys.detail(args.questionId) });
    },
  });
}

