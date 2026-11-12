"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { questionBankApi } from "./api";
import { qbKeys } from "./queryKeys";
import type {
  QbBulkInput,
  QbClearImages,
  QbImageFiles,
  QbQuestionFilters,
  QbWritePayload,
} from "./types";

// ── Queries ───────────────────────────────────────────────────────────────────
export function useQbQuestions(filters?: QbQuestionFilters) {
  return useQuery({
    queryKey: qbKeys.questions(filters),
    queryFn: () => questionBankApi.listQuestions(filters),
    staleTime: 5_000,
  });
}

export function useQbQuestion(id: number) {
  return useQuery({
    queryKey: qbKeys.question(id),
    queryFn: () => questionBankApi.getQuestion(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useQbDomains(subject?: string) {
  return useQuery({
    queryKey: qbKeys.domains(subject),
    queryFn: () => questionBankApi.listDomains(subject),
    staleTime: 60_000,
  });
}

export function useQbSkills(params?: { domain?: number; subject?: string }) {
  return useQuery({
    queryKey: qbKeys.skills(params),
    queryFn: () => questionBankApi.listSkills(params),
    enabled: !!params?.domain || !!params?.subject,
    staleTime: 60_000,
  });
}




// ── Mutations ─────────────────────────────────────────────────────────────────
function useInvalidateQuestions() {
  const qc = useQueryClient();
  return (id?: number) => {
    qc.invalidateQueries({ queryKey: [...qbKeys.all, "questions"] });
    if (id) qc.invalidateQueries({ queryKey: qbKeys.question(id) });
  };
}

export function useQbCreateQuestion() {
  const invalidate = useInvalidateQuestions();
  return useMutation({
    mutationFn: (vars: { payload: QbWritePayload; files?: QbImageFiles; clears?: QbClearImages }) =>
      questionBankApi.createQuestion(vars.payload, vars.files, vars.clears),
    onSuccess: () => invalidate(),
  });
}

export function useQbUpdateQuestion() {
  const invalidate = useInvalidateQuestions();
  return useMutation({
    mutationFn: (vars: {
      id: number;
      payload: QbWritePayload;
      files?: QbImageFiles;
      clears?: QbClearImages;
    }) => questionBankApi.updateQuestion(vars.id, vars.payload, vars.files, vars.clears),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useQbArchive() {
  const invalidate = useInvalidateQuestions();
  return useMutation({
    mutationFn: (id: number) => questionBankApi.archiveQuestion(id),
    onSuccess: (_d, id) => invalidate(id),
  });
}

export function useQbRestore() {
  const invalidate = useInvalidateQuestions();
  return useMutation({
    mutationFn: (id: number) => questionBankApi.restoreQuestion(id),
    onSuccess: (_d, id) => invalidate(id),
  });
}





export function useQbBulk() {
  const invalidate = useInvalidateQuestions();
  return useMutation({
    mutationFn: (payload: QbBulkInput) => questionBankApi.bulk(payload),
    onSuccess: () => invalidate(),
  });
}


