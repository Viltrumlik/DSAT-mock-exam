"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { questionBankApi } from "./api";
import { qbKeys } from "./queryKeys";
import type {
  QbBulkInput,
  QbClassifyInput,
  QbClearImages,
  QbImageFiles,
  QbQuestionFilters,
  QbValidation,
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

export function useQbBatches(status?: string) {
  return useQuery({
    queryKey: qbKeys.batches(status),
    queryFn: () => questionBankApi.listBatches(status),
    staleTime: 5_000,
  });
}

export function useQbBatch(id: number) {
  return useQuery({
    queryKey: qbKeys.batch(id),
    queryFn: () => questionBankApi.getBatch(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useQbCandidates(batchId: number, validationStatus?: QbValidation) {
  return useQuery({
    queryKey: qbKeys.candidates(batchId, validationStatus),
    queryFn: () => questionBankApi.listCandidates(batchId, validationStatus),
    enabled: Number.isFinite(batchId) && batchId > 0,
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

export function useQbClassify() {
  const invalidate = useInvalidateQuestions();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: QbClassifyInput }) =>
      questionBankApi.classify(id, payload),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useQbApprove() {
  const invalidate = useInvalidateQuestions();
  return useMutation({
    mutationFn: (id: number) => questionBankApi.approve(id),
    onSuccess: (_d, id) => invalidate(id),
  });
}

export function useQbReject() {
  const invalidate = useInvalidateQuestions();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      questionBankApi.reject(id, reason ?? ""),
    onSuccess: (_d, vars) => invalidate(vars.id),
  });
}

export function useQbAcceptSuggestion() {
  const invalidate = useInvalidateQuestions();
  return useMutation({
    mutationFn: (id: number) => questionBankApi.acceptSuggestion(id),
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

export function useQbUploadBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => questionBankApi.uploadBatch(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...qbKeys.all, "batches"] }),
  });
}

export function useQbPromoteBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => questionBankApi.promoteBatch(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: qbKeys.batch(id) });
      qc.invalidateQueries({ queryKey: [...qbKeys.all, "batches"] });
      qc.invalidateQueries({ queryKey: [...qbKeys.all, "candidates"] });
      qc.invalidateQueries({ queryKey: [...qbKeys.all, "questions"] });
    },
  });
}
