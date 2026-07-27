"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { vocabularyAdminApi } from "./api";
import type {
  SectionCreatePayload,
  SectionUpdatePayload,
  SetCreatePayload,
  SetUpdatePayload,
  WordCreatePayload,
  WordUpdatePayload,
} from "./types";

/**
 * Separate from `vocabularyKeys` (the student cache): the builder reads the
 * same rows through a different serializer, so sharing keys would let one
 * surface hand the other a payload it cannot render.
 */
export const vocabularyAdminKeys = {
  all: ["vocabulary", "admin"] as const,
  sections: () => [...vocabularyAdminKeys.all, "sections"] as const,
  sets: (sectionId: number) => [...vocabularyAdminKeys.all, "sets", sectionId] as const,
  words: (setId: number) => [...vocabularyAdminKeys.all, "words", setId] as const,
};

const enabledId = (id: number | undefined | null) => Number.isFinite(id) && Number(id) > 0;

// ─── Reads ───────────────────────────────────────────────────────────────────

export function useAdminSections() {
  return useQuery({
    queryKey: vocabularyAdminKeys.sections(),
    queryFn: vocabularyAdminApi.listSections,
  });
}

export function useAdminSets(sectionId: number) {
  return useQuery({
    queryKey: vocabularyAdminKeys.sets(sectionId),
    queryFn: () => vocabularyAdminApi.listSets(sectionId),
    enabled: enabledId(sectionId),
  });
}

export function useAdminWords(setId: number) {
  return useQuery({
    queryKey: vocabularyAdminKeys.words(setId),
    queryFn: () => vocabularyAdminApi.listWords(setId),
    enabled: enabledId(setId),
  });
}

// ─── Sections ────────────────────────────────────────────────────────────────

export function useCreateSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SectionCreatePayload) => vocabularyAdminApi.createSection(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: vocabularyAdminKeys.sections() }),
  });
}

export function useUpdateSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: number; patch: SectionUpdatePayload }) =>
      vocabularyAdminApi.updateSection(args.id, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: vocabularyAdminKeys.sections() }),
  });
}

export function useDeleteSection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => vocabularyAdminApi.deleteSection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: vocabularyAdminKeys.sections() }),
  });
}

// ─── Sets ────────────────────────────────────────────────────────────────────

// A set write moves the parent section's set_count/word_count, so the section
// list is invalidated alongside the set list on every one of these.
function useSetMutationInvalidator(sectionId: number) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: vocabularyAdminKeys.sets(sectionId) }),
      qc.invalidateQueries({ queryKey: vocabularyAdminKeys.sections() }),
    ]);
}

export function useCreateSet(sectionId: number) {
  const invalidate = useSetMutationInvalidator(sectionId);
  return useMutation({
    mutationFn: (payload: SetCreatePayload) => vocabularyAdminApi.createSet(sectionId, payload),
    onSuccess: invalidate,
  });
}

export function useUpdateSet(sectionId: number) {
  const invalidate = useSetMutationInvalidator(sectionId);
  return useMutation({
    mutationFn: (args: { setId: number; patch: SetUpdatePayload }) =>
      vocabularyAdminApi.updateSet(args.setId, args.patch),
    onSuccess: invalidate,
  });
}

export function useDeleteSet(sectionId: number) {
  const invalidate = useSetMutationInvalidator(sectionId);
  return useMutation({
    mutationFn: (setId: number) => vocabularyAdminApi.deleteSet(setId),
    onSuccess: invalidate,
  });
}

// ─── Words ───────────────────────────────────────────────────────────────────

// A word write moves the set's word_count and the section's word_count too,
// so all three levels are refreshed.
function useWordMutationInvalidator(sectionId: number, setId: number) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: vocabularyAdminKeys.words(setId) }),
      qc.invalidateQueries({ queryKey: vocabularyAdminKeys.sets(sectionId) }),
      qc.invalidateQueries({ queryKey: vocabularyAdminKeys.sections() }),
    ]);
}

export function useCreateWord(sectionId: number, setId: number) {
  const invalidate = useWordMutationInvalidator(sectionId, setId);
  return useMutation({
    mutationFn: (payload: WordCreatePayload) => vocabularyAdminApi.createWord(setId, payload),
    onSuccess: invalidate,
  });
}

export function useUpdateWord(sectionId: number, setId: number) {
  const invalidate = useWordMutationInvalidator(sectionId, setId);
  return useMutation({
    mutationFn: (args: { wordId: number; patch: WordUpdatePayload }) =>
      vocabularyAdminApi.updateWord(args.wordId, args.patch),
    onSuccess: invalidate,
  });
}

export function useDeleteWord(sectionId: number, setId: number) {
  const invalidate = useWordMutationInvalidator(sectionId, setId);
  return useMutation({
    mutationFn: (wordId: number) => vocabularyAdminApi.deleteWord(wordId),
    onSuccess: invalidate,
  });
}

// ─── CSV import ──────────────────────────────────────────────────────────────

/** Section import can mint whole sets, so it refreshes the set list too. */
export function useImportSectionCsv(sectionId: number) {
  const invalidate = useSetMutationInvalidator(sectionId);
  return useMutation({
    mutationFn: (file: File) => vocabularyAdminApi.importSectionCsv(sectionId, file),
    onSuccess: invalidate,
  });
}

export function useImportSetCsv(sectionId: number, setId: number) {
  const invalidate = useWordMutationInvalidator(sectionId, setId);
  return useMutation({
    mutationFn: (file: File) => vocabularyAdminApi.importSetCsv(setId, file),
    onSuccess: invalidate,
  });
}
