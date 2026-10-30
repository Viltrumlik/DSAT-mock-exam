/**
 * Domain API: Questions
 *
 * All question-related data fetching goes through this module.
 * Components never call lib/api or features/* transport directly —
 * they call these domain functions.
 *
 * This layer is responsible for:
 *   - Translating transport responses into domain types
 *   - Aggregating multi-request data (e.g. cross-set question listing)
 *   - Providing a stable interface that survives backend contract changes
 */

import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import type { AssessmentQuestion } from "@/features/assessments/types";
import type { QuestionWithContext, QuestionBankFilters } from "../types";

/**
 * List all questions across all assessment sets the current user can access.
 *
 * Implementation note: the backend's /assessments/admin/sets/ endpoint returns
 * sets with questions nested (AssessmentSetSerializer prefetches questions).
 * Every page is read (`listAllSets`): the catalogue passed one page of 200 on 2026-10-28.
 *
 * Future: replace with a dedicated /assessments/admin/questions/ list endpoint
 * once the question bank needs server-side text search.
 *
 * @param filters Optional subject filter (applied server-side).
 */
export async function listAllQuestions(
  filters?: Pick<QuestionBankFilters, "subject">,
): Promise<QuestionWithContext[]> {
  const params =
    filters?.subject && filters.subject !== "all" ? { subject: filters.subject } : undefined;

  const data = await assessmentsAdminApi.listAllSets(params);
  const out: QuestionWithContext[] = [];

  for (const set of data.results) {
    for (const q of set.questions ?? []) {
      out.push({
        ...q,
        setId: set.id,
        setTitle: set.title,
        subject: set.subject,
        category: set.category ?? "",
        setIsPublished: Boolean(set.is_active),
      });
    }
  }

  // Sort: active first, then by set, then by question order
  out.sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    if (a.setId !== b.setId) return a.setId - b.setId;
    return (a.order ?? 0) - (b.order ?? 0);
  });

  return out;
}

/**
 * Get a single question by id from the question bank.
 * Requires the setId because the backend question detail endpoint is
 * at /assessments/admin/questions/{id}/ (not nested under set).
 */
export async function getQuestion(questionId: number): Promise<AssessmentQuestion> {
  return assessmentsAdminApi.getSet(questionId) as unknown as AssessmentQuestion;
}

/**
 * Apply client-side filters to an already-loaded question list.
 * Server-side filtering handles subject; this handles the rest.
 */
export function applyClientFilters(
  questions: QuestionWithContext[],
  filters: QuestionBankFilters,
): QuestionWithContext[] {
  let result = questions;

  if (filters.questionType && filters.questionType !== "all") {
    result = result.filter((q) => q.question_type === filters.questionType);
  }

  if (filters.activeStatus === "active") {
    result = result.filter((q) => q.is_active);
  } else if (filters.activeStatus === "inactive") {
    result = result.filter((q) => !q.is_active);
  }

  if (filters.setId && filters.setId !== "all") {
    result = result.filter((q) => q.setId === filters.setId);
  }

  if (filters.search) {
    const term = filters.search.toLowerCase().trim();
    if (term.length >= 2) {
      result = result.filter(
        (q) =>
          q.prompt.toLowerCase().includes(term) ||
          q.setTitle.toLowerCase().includes(term) ||
          q.category.toLowerCase().includes(term),
      );
    }
  }

  return result;
}

/**
 * Statistics derived from a question list — used in the Question Bank header.
 */
export function computeQuestionBankStats(questions: QuestionWithContext[]) {
  const total = questions.length;
  const active = questions.filter((q) => q.is_active).length;
  const byType = questions.reduce<Record<string, number>>((acc, q) => {
    acc[q.question_type] = (acc[q.question_type] ?? 0) + 1;
    return acc;
  }, {});
  const setCount = new Set(questions.map((q) => q.setId)).size;

  return { total, active, inactive: total - active, byType, setCount };
}
