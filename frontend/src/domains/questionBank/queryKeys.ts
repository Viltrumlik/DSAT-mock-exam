import type { QbQuestionFilters } from "./types";

export const qbKeys = {
  all: ["questionBank"] as const,
  questions: (f?: QbQuestionFilters) => [...qbKeys.all, "questions", f ?? {}] as const,
  question: (id: number) => [...qbKeys.all, "question", id] as const,
  domains: (subject?: string) => [...qbKeys.all, "domains", subject ?? "all"] as const,
  skills: (p?: { domain?: number; subject?: string }) => [...qbKeys.all, "skills", p ?? {}] as const,
  batches: (status?: string) => [...qbKeys.all, "batches", status ?? "all"] as const,
  batch: (id: number) => [...qbKeys.all, "batch", id] as const,
  candidates: (id: number, validationStatus?: string) =>
    [...qbKeys.all, "candidates", id, validationStatus ?? "all"] as const,
};
