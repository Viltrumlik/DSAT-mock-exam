/**
 * Domain API: Assessments
 *
 * Assessment set CRUD and publishing operations.
 * All callers should use this module, not features/assessmentsAdmin/api directly.
 */

import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import type { AssessmentSet } from "@/features/assessments/types";
import type { AssessmentSetFilters } from "../types";

export type PaginatedAssessmentSets = {
  count: number;
  results: AssessmentSet[];
  next: string | null;
  previous: string | null;
};

/**
 * List assessment sets with optional filtering.
 */
export async function listAssessmentSets(
  filters?: AssessmentSetFilters & { limit?: number; offset?: number },
): Promise<PaginatedAssessmentSets> {
  const params: Record<string, unknown> = {
    limit: filters?.limit ?? 50,
    offset: filters?.offset ?? 0,
  };

  if (filters?.subject && filters.subject !== "all") {
    params.subject = filters.subject;
  }
  if (filters?.category && filters.category !== "all") {
    params.category = filters.category;
  }

  return assessmentsAdminApi.listSets(params as Parameters<typeof assessmentsAdminApi.listSets>[0]);
}

/**
 * Get a single assessment set with all questions populated.
 */
export async function getAssessmentSet(id: number): Promise<AssessmentSet> {
  return assessmentsAdminApi.getSet(id);
}

/**
 * Create a new assessment set (always starts in DRAFT state).
 */
export async function createAssessmentSet(payload: {
  subject: "math" | "english";
  category?: string;
  title: string;
  description?: string;
}): Promise<AssessmentSet> {
  return assessmentsAdminApi.createSet({ ...payload, is_active: false });
}

/**
 * Archive an assessment set (transitions to ARCHIVED / is_active: false).
 * Only allowed if no active assignments are using this set.
 */
export async function archiveAssessmentSet(id: number): Promise<AssessmentSet> {
  return assessmentsAdminApi.updateSet(id, { is_active: false });
}

/**
 * Extract unique category values from a set list for filter UI.
 */
export function extractCategories(sets: AssessmentSet[]): string[] {
  const cats = new Set<string>();
  for (const s of sets) {
    if (s.category) cats.add(s.category);
  }
  return Array.from(cats).sort();
}
