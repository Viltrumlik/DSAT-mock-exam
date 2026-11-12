/**
 * Domain: Questions
 * Canonical type definitions for the question authoring domain.
 *
 * These types are the single source of truth for question-related data across
 * the questions console, assignment flows, and student attempt surfaces.
 *
 * Rule: All components in the questions console import from here, not from
 * features/assessments/types or lib/api directly.
 */

import type { AssessmentQuestion, AssessmentSet, Subject } from "@/features/assessments/types";

// Re-export primitives that callers need alongside domain types
export type { AssessmentQuestion, AssessmentSet, Subject };
export type { AssessmentChoice, AssessmentQuestionType } from "@/features/assessments/types";

/**
 * A question enriched with its containing set's context.
 * This is the primary record in the Question Bank view — one row per question,
 * with enough set metadata to show lineage and navigate to the editor.
 */
export type QuestionWithContext = AssessmentQuestion & {
  /** The assessment set this question belongs to. */
  setId: number;
  setTitle: string;
  subject: Subject;
  category: string;
  /**
   * Whether the parent set is currently published (is_active === true).
   * When true, this question is IN_USE — edits create a new revision.
   */
  setIsPublished: boolean;
};

/**
 * Usage status of a question relative to published snapshots.
 *
 * FREE     — question is not referenced by any published AssessmentSetVersion.
 *            Can be edited in-place.
 * IN_USE   — at least one published SetVersion snapshot contains this question.
 *            Editing triggers duplicate-on-edit (new question record is created;
 *            original is preserved in all existing snapshots).
 * RETIRED  — was IN_USE; all referencing SetVersions are now SUPERSEDED.
 *            Can be archived.
 *
 * @note Until the snapshot architecture is deployed, all questions show as FREE.
 *       The field exists in the type layer to avoid future breaking changes.
 */
export type QuestionUsageStatus = "FREE" | "IN_USE" | "RETIRED";

/**
 * Question lifecycle state as defined in the system governance document.
 */
export type QuestionLifecycleState =
  | "DRAFT"
  | "ACTIVE"
  | "UNDER_REVISION"
  | "DEPRECATED"
  | "ARCHIVED"
  | "REJECTED";

/** The category name for a set that has none — what Categories lists and what the bank's category filter matches. */
export const UNCATEGORISED_CATEGORY = "(Uncategorised)";

/**
 * Filters that can be applied to the Question Bank listing.
 */
export type QuestionBankFilters = {
  subject?: Subject | "all";
  questionType?: AssessmentQuestion["question_type"] | "all";
  activeStatus?: "active" | "inactive" | "all";
  setId?: number | "all";
  /** A set's category, trimmed; UNCATEGORISED_CATEGORY for the sets without one. */
  category?: string | "all";
  search?: string;
};
