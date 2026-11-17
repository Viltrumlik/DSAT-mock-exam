"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

/** One skill or topic in a picker list. `retired` only ever comes back to the builder, flagged. */
export type SkillTaxonomySkill = { id: number; name: string; retired?: boolean };

/** One domain plus its skills — the tree a grouped `<optgroup>` picker needs. */
export type SkillTaxonomyDomain = {
  domain_id: number;
  domain: string;
  subject: string;
  /** Blank for the SAT taxonomy; a level code for that level's own topic list. */
  level?: string;
  skills: SkillTaxonomySkill[];
};

/** What the picker gets: the list, and whether this viewer may add to it ("+ New topic"). */
export type SkillTaxonomy = {
  domains: SkillTaxonomyDomain[];
  /** True only on a level's own topic list (junior / foundation math), and only for an admin. */
  canManageTopics: boolean;
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
  all: ["questionbank", "taxonomy"] as const,
  bySubject: (subject: string, level = "") => ["questionbank", "taxonomy", subject, level] as const,
};

/** Every open picker refetches — called after an admin adds, renames, reorders or retires a topic. */
export function invalidateSkillTaxonomy(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: skillTaxonomyKeys.all });
}

/**
 * GET /api/questionbank/taxonomy/?subject=…&level=…&include_retired=1 — questions-console only.
 * A failure is never retried: it just leaves the picker empty (unclassified stays legal).
 *
 * `level` is a midterm's level. A level with its own topic list (junior math) gets that
 * list INSTEAD of the SAT taxonomy; any other level, or none, gets the SAT taxonomy.
 *
 * Retired topics come back flagged, so a question that already carries one still names it;
 * the picker offers them to nothing else. An admin can now change a list from the builder,
 * so another admin's new topic shows up within a minute rather than half an hour.
 */
export function useSkillTaxonomyQuery(subject: BankSubject | null, level?: string | null) {
  const lvl = (level ?? "").trim().toLowerCase();
  return useQuery({
    queryKey: skillTaxonomyKeys.bySubject(subject ?? "none", lvl),
    queryFn: async (): Promise<SkillTaxonomy> => {
      const r = await api.get("/questionbank/taxonomy/", {
        params: { subject, include_retired: 1, ...(lvl ? { level: lvl } : {}) },
      });
      const body = r.data as { results?: SkillTaxonomyDomain[]; can_manage_topics?: boolean } | null;
      return {
        domains: Array.isArray(body?.results) ? body!.results : [],
        canManageTopics: Boolean(body?.can_manage_topics),
      };
    },
    enabled: subject !== null,
    staleTime: 60 * 1000,
    retry: false,
  });
}
