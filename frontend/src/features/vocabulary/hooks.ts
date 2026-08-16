"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { normalizeApiError } from "@/lib/apiError";

import { vocabularyApi } from "./api";
import { vocabularyKeys } from "./queryKeys";
import type { SessionResult, SessionStartPayload } from "./types";

const enabledId = (id: number | undefined | null) => Number.isFinite(id) && Number(id) > 0;

export function useVocabSections() {
  return useQuery({
    queryKey: vocabularyKeys.sections(),
    queryFn: vocabularyApi.listSections,
  });
}

export function useVocabSection(sectionId: number) {
  return useQuery({
    queryKey: vocabularyKeys.section(sectionId),
    queryFn: () => vocabularyApi.getSection(sectionId),
    enabled: enabledId(sectionId),
  });
}

export function useVocabSet(setId: number) {
  return useQuery({
    queryKey: vocabularyKeys.set(setId),
    queryFn: () => vocabularyApi.getSet(setId),
    enabled: enabledId(setId),
  });
}

export function useMySets() {
  return useQuery({
    queryKey: vocabularyKeys.mySets(),
    queryFn: vocabularyApi.listMySets,
  });
}

export function useVocabHomework() {
  return useQuery({
    queryKey: vocabularyKeys.homework(),
    queryFn: vocabularyApi.listHomework,
  });
}

/** Bank search for the custom-set builder. Pass an already-debounced query. */
export function useWordSearch(q: string, section?: number) {
  return useQuery({
    queryKey: vocabularyKeys.wordSearch(q, section),
    queryFn: () => vocabularyApi.searchWords({ q, section, limit: 40 }),
    enabled: q.trim().length > 0,
    placeholderData: (prev) => prev,
  });
}

export function useCreateMySet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; word_ids: number[] }) => vocabularyApi.createMySet(body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: vocabularyKeys.mySets() });
    },
    onError: (e) => {
      throw normalizeApiError(e);
    },
  });
}

export function useUpdateMySet(setId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title?: string; word_ids?: number[] }) => vocabularyApi.updateMySet(setId, body),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: vocabularyKeys.mySets() }),
        qc.invalidateQueries({ queryKey: vocabularyKeys.set(setId) }),
      ]);
    },
    onError: (e) => {
      throw normalizeApiError(e);
    },
  });
}

export function useDeleteMySet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (setId: number) => vocabularyApi.deleteMySet(setId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: vocabularyKeys.mySets() });
    },
    onError: (e) => {
      throw normalizeApiError(e);
    },
  });
}

export function useStartSession() {
  return useMutation({
    mutationFn: (body: SessionStartPayload) => vocabularyApi.startSession(body),
    onError: (e) => {
      throw normalizeApiError(e);
    },
  });
}

/**
 * Finishing a session rewrites word statuses and may flip the set to completed,
 * so every surface that shows progress is invalidated.
 */
export function useFinishSession(setId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { sessionId: number; duration_ms: number; results: SessionResult[] }) =>
      vocabularyApi.finishSession(args.sessionId, {
        duration_ms: args.duration_ms,
        results: args.results,
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: vocabularyKeys.set(setId) }),
        qc.invalidateQueries({ queryKey: vocabularyKeys.sections() }),
        qc.invalidateQueries({ queryKey: vocabularyKeys.mySets() }),
        qc.invalidateQueries({ queryKey: vocabularyKeys.homework() }),
      ]);
    },
    onError: (e) => {
      throw normalizeApiError(e);
    },
  });
}
