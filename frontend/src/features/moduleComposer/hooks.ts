"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { examsAdminApi } from "@/lib/api";
import { questionBankKeys } from "@/features/questionBank/queryKeys";
import { moduleComposerKeys } from "./queryKeys";
import { questionsModuleKeys } from "@/features/questionsAdmin/queryKeys";
import type { AdminStandaloneQuestion } from "@/features/questionBank/types";
import type { SubjectFilter } from "@/features/questionBank/types";

function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)) {
    return (data as { results: T[] }).results;
  }
  return [];
}

const PAGE_SIZE = 40;

export function useComposerBankQuery(args: {
  enabled: boolean;
  excludeModuleId: number;
  subject: SubjectFilter;
  categoryId: number | "all";
  q: string;
  offset: number;
}) {
  return useQuery({
    queryKey: moduleComposerKeys.bank({
      excludeModuleId: args.excludeModuleId,
      subject: args.subject,
      categoryId: args.categoryId,
      q: args.q,
      offset: args.offset,
      pageSize: PAGE_SIZE,
    }),
    queryFn: async () =>
      unwrapList<AdminStandaloneQuestion>(
        await examsAdminApi.listStandaloneQuestions({
          composer: "1",
          exclude_module: args.excludeModuleId,
          subject: args.subject,
          category: args.categoryId,
          is_active: "1",
          status: "approved",
          q: args.q || undefined,
          limit: PAGE_SIZE,
          offset: args.offset,
        }),
      ),
    enabled:
      args.enabled &&
      Number.isFinite(args.excludeModuleId) &&
      args.excludeModuleId > 0 &&
      (args.subject === "MATH" || args.subject === "READING_WRITING"),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useComposerAssign(testId: number, moduleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (questionId: number) => {
      return await examsAdminApi.assignStandaloneQuestionToModule(testId, moduleId, { question_id: questionId });
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: questionBankKeys.all });
      await qc.invalidateQueries({ queryKey: moduleComposerKeys.all });
      await qc.invalidateQueries({ queryKey: questionsModuleKeys.list(testId, moduleId) });
    },
  });
}

export function useComposerUnlink(testId: number, moduleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (questionId: number) => {
      return await examsAdminApi.unlinkQuestionFromModule(testId, moduleId, questionId);
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: questionBankKeys.all });
      await qc.invalidateQueries({ queryKey: moduleComposerKeys.all });
      await qc.invalidateQueries({ queryKey: questionsModuleKeys.list(testId, moduleId) });
    },
  });
}

export { PAGE_SIZE };
