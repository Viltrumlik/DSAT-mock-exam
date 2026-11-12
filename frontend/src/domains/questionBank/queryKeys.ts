import type { QbQuestionFilters } from "./types";

export const qbKeys = {
  all: ["questionBank"] as const,
  questions: (f?: QbQuestionFilters) => [...qbKeys.all, "questions", f ?? {}] as const,
  question: (id: number) => [...qbKeys.all, "question", id] as const,
  domains: (subject?: string) => [...qbKeys.all, "domains", subject ?? "all"] as const,
  skills: (p?: { domain?: number; subject?: string }) => [...qbKeys.all, "skills", p ?? {}] as const,
};
