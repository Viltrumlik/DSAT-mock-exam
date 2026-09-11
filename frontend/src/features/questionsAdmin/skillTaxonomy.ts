"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

/** One domain plus its skills — the tree a grouped `<optgroup>` picker needs. */
export type SkillTaxonomyDomain = {
  domain_id: number;
  domain: string;
  subject: string;
  /** Blank for the SAT taxonomy; a level code for that level's own topic list. */
  level?: string;
  skills: { id: number; name: string }[];
};

/** The Question Bank's subject scope. There is no separate Reading/Writing split there. */
export type BankSubject = "MATH" | "ENGLISH";

/**
 * `exams.Question.question_type` is MATH / READING / WRITING, but the Question Bank
 * scopes its skills as MATH / ENGLISH — Reading and Writing are two halves of the same
 * bank subject. Every caller that turns a question into a skill list goes through here.
 */
export function bankSubjectForQuestionType(questionType: string | null | undefined): BankSubject | null {
  switch (questionType) {
    case "MATH":
      return "MATH";
    case "READING":
    case "WRITING":
      return "ENGLISH";
    default:
      return null;
  }
}

export const skillTaxonomyKeys = {
  bySubject: (subject: string, level = "") => ["questionbank", "taxonomy", subject, level] as const,
};

/**
 * GET /api/questionbank/taxonomy/?subject=…&level=… — read-only, questions-console only.
 * The taxonomy only changes when someone reseeds it, so this is cached aggressively
 * and never retried: a failure just leaves the picker empty (unclassified stays legal).
 *
 * `level` is a midterm's level. A level with its own topic list (junior math) gets that
 * list INSTEAD of the SAT taxonomy; any other level, or none, gets the SAT taxonomy.
 */
export function useSkillTaxonomyQuery(subject: BankSubject | null, level?: string | null) {
  const lvl = (level ?? "").trim().toLowerCase();
  return useQuery({
    queryKey: skillTaxonomyKeys.bySubject(subject ?? "none", lvl),
    queryFn: async (): Promise<SkillTaxonomyDomain[]> => {
      const r = await api.get("/questionbank/taxonomy/", { params: { subject, ...(lvl ? { level: lvl } : {}) } });
      const results = (r.data as { results?: SkillTaxonomyDomain[] } | null)?.results;
      return Array.isArray(results) ? results : [];
    },
    enabled: subject !== null,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
}
