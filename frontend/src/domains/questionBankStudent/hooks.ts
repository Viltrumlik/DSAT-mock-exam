"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { practiceApi, type PracticeFilters } from "./api";

export function usePracticeList(filters?: PracticeFilters) {
  return useQuery({
    queryKey: ["qbPractice", "list", filters ?? {}],
    queryFn: () => practiceApi.list(filters),
    staleTime: 10_000,
  });
}

export function usePracticeQuestion(id: number | null) {
  return useQuery({
    queryKey: ["qbPractice", "detail", id],
    queryFn: () => practiceApi.get(id as number),
    enabled: !!id && id > 0,
  });
}

export function usePracticeTaxonomy(subject?: string) {
  return useQuery({
    queryKey: ["qbPractice", "taxonomy", subject ?? "all"],
    queryFn: () => practiceApi.taxonomy(subject),
    staleTime: 60_000,
  });
}

export function usePracticeAnswer() {
  return useMutation({
    mutationFn: (vars: { id: number; answer: string }) => practiceApi.answer(vars.id, vars.answer),
  });
}
